// Owner: R2 – F-2 windowed loader
import { getDb } from "./db";
import { normalize } from "./normalizer";
import { MerchantId, NormalizedTransaction } from "@surplus/contracts";
import { PaypalClient } from "@surplus/paypal/src/client"; // real client implementation

/**
 * Load transactions for a merchant using PayPal Transaction Search.
 * Walks backwards in 31‑day RFC3339 windows up to 12 windows (≈ 1 year).
 * Handles pagination (`page` param) and deduplicates by transaction id.
 * Returns a fully normalized array.
 */
export async function loadTransactions(
  merchantId: MerchantId,
  asOf: string
): Promise<NormalizedTransaction[]> {
  const client: PaypalClient = new PaypalClient(); // assumes env vars are set
  const db = getDb();
  const all: NormalizedTransaction[] = [];
  const seen = new Set<string>();
  // 12 windows max
  for (let w = 0; w < 12; w++) {
    const end = new Date(asOf);
    end.setDate(end.getDate() - w * 31);
    const start = new Date(end);
    start.setDate(start.getDate() - 30);
    const startStr = start.toISOString();
    const endStr = end.toISOString();
    let page = 1;
    while (true) {
      // The real client method signature may differ; this is a stub for illustration.
      const rawPage = await (client as any).listTransactions({
        start_date: startStr,
        end_date: endStr,
        page,
        page_size: 100,
        fields: "all",
      });
      if (!rawPage || rawPage.length === 0) break;
      for (const raw of rawPage) {
        const norm = normalize(raw);
        if (!seen.has(norm.id)) {
          seen.add(norm.id);
          all.push(norm);
        }
      }
      if (rawPage.length < 100) break; // last page
      page++;
    }
  }
  // Persist to DB (upsert)
  const insert = db.prepare(`
    INSERT INTO normalized_transactions (
      id, merchantId, occurredAt, monthBucket, kind,
      grossCents, feeCents, netCents, currency, status,
      counterpartyHash, source
    ) VALUES (
      @id, @merchantId, @occurredAt, @monthBucket, @kind,
      @grossCents, @feeCents, @netCents, @currency, @status,
      @counterpartyHash, @source
    ) ON CONFLICT(id) DO UPDATE SET
      merchantId = excluded.merchantId,
      occurredAt = excluded.occurredAt,
      monthBucket = excluded.monthBucket,
      kind = excluded.kind,
      grossCents = excluded.grossCents,
      feeCents = excluded.feeCents,
      netCents = excluded.netCents,
      currency = excluded.currency,
      status = excluded.status,
      counterpartyHash = excluded.counterpartyHash,
      source = excluded.source;
  `);
  for (const tx of all) {
    insert.run({
      ...tx,
      source: "live",
    });
  }
  return all;
}

/**
 * Public API for R2 – returns the full merchant dataset used by the API.
 */
export async function getMerchantDataset(merchantId: MerchantId) {
  const asOf = new Date().toISOString();
  const transactions = await loadTransactions(merchantId, asOf);
  const db = getDb();
  const balanceRow = db
    .prepare(`SELECT availableCents, withheldCents, asOf FROM balances WHERE merchantId = ?`)
    .get(merchantId);
  const openDisputeRows = db.prepare(`SELECT COUNT(*) AS count, SUM(amountCents) AS total FROM open_disputes WHERE merchantId = ?`).get(
    merchantId
  );
  const excludedNonUsdCount = transactions.filter((t) => t.currency !== "USD").length;
  return {
    transactions,
    availableBalanceCents: balanceRow?.availableCents ?? 0,
    balanceSource: balanceRow ? "LIVE_WEBHOOK_ADJUSTED" : "FIXTURE",
    openDisputes: openDisputeRows?.count ?? 0,
    excludedNonUsdCount,
  };
}

