// Owner: R2 – Spike S‑2: Orders v2 capture & hybrid store proof
import { getDb } from "../sources/db";
import crypto from "crypto";

/** Minimal sandbox client – real implementation lives in @surplus/paypal/src/client */
interface PayPalClient {
  createOrder(amountCents: number): Promise<{ id: string }>;
  captureOrder(orderId: string): Promise<{ id: string; status: string; amount: { value: string }; payer: { email_address: string } }>;
}

function loadClient(): PayPalClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PaypalClient } = require("@surplus/paypal/src/client");
  // @ts-ignore – runtime provides the class
  return new PaypalClient();
}

export async function runSpike(): Promise<string> {
  const client = loadClient();
  const order = await client.createOrder(120_000); // $1,200
  const capture = await client.captureOrder(order.id);

  const db = getDb();
  const now = new Date().toISOString();
  const monthBucket = now.slice(0, 7);
  const amountCents = Math.round(parseFloat(capture.amount.value) * 100);
  const hash = crypto.createHash("sha256").update(capture.payer.email_address.toLowerCase()).digest("hex").slice(0, 8);

  db.prepare(`
    INSERT INTO normalized_transactions (
      id, merchantId, occurredAt, monthBucket, kind,
      grossCents, feeCents, netCents, currency, status,
      counterpartyHash, source
    ) VALUES (
      @id, @merchantId, @occurredAt, @monthBucket, 'income',
      @grossCents, 0, @grossCents, 'USD', @status,
      @counterpartyHash, 'live'
    ) ON CONFLICT(id) DO NOTHING;
  `).run({
    id: capture.id,
    merchantId: "live_sandbox",
    occurredAt: now,
    monthBucket,
    grossCents: amountCents,
    status: capture.status,
    counterpartyHash: hash,
  });

  db.close();
  return capture.id;
}

if (require.main === module) {
  runSpike()
    .then((id) => console.log(`✅ Capture ${id} stored`))
    .catch((e) => {
      console.error("❌ Spike failed", e);
      process.exit(1);
    });
}
