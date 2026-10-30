// Owner: R2 – Spike S‑2: Orders v2 capture & hybrid store proof
import { getDb } from "../sources/db.js";
import crypto from "node:crypto";
import { PaypalClient } from "../client/PaypalClient.js";

interface OrdersClient {
  createOrder?(amountCents: number): Promise<{ id: string }>;
  captureOrder?(orderId: string): Promise<{
    id: string;
    status: string;
    amount: { value: string };
    payer: { email_address: string };
  }>;
}

export async function runSpike(): Promise<string> {
  const client: OrdersClient = new PaypalClient({
    clientId: process.env["PAYPAL_CLIENT_ID"] ?? "test",
    clientSecret: process.env["PAYPAL_CLIENT_SECRET"] ?? "test",
    baseUrl: process.env["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com",
  }) as unknown as OrdersClient;

  if (!client.createOrder || !client.captureOrder) {
    return "orders_v2_pending";
  }

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

if (process.argv[1]?.endsWith("s2_seed.ts")) {
  runSpike()
    .then((id) => console.log(`✅ Capture ${id} stored`))
    .catch((e) => {
      console.error("❌ Spike failed", e);
      process.exit(1);
    });
}
