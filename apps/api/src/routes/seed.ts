// Owner: R1. Task C-12: seed-on-boot adapter.
//
// TEMPORARY until R2's scripts/seed.ts runs the hybrid SQLite + Sandbox seed.
// Live merchants must never be seeded with fixture transactions or a fixture
// balance: until R2 fetches the real PayPal balance, the live view starts empty
// and is built up only by verified webhooks.
import type { MerchantId } from "@surplus/contracts";
import type { MerchantDataset } from "./dataset";
import type { InMemoryWebhookStore } from "./webhookStore";

export const SEEDED_MERCHANTS: readonly MerchantId[] = ["live_sandbox"];

/** Empty starting point for a live merchant. No fixture data is mixed in. */
export const EMPTY_LIVE_DATASET: MerchantDataset = {
  transactions: [],
  availableBalanceCents: 0,
  balanceSource: "LIVE_WEBHOOK_ADJUSTED",
  openDisputes: {
    count: 0,
    totalAmountCents: 0,
    unheldAmountCents: 0,
  },
  excludedNonUsdCount: 0,
};

/**
 * Seeds every merchant the in-memory store serves.
 * TODO(R2): call the real seed.ts (fixtures + live baseline) instead.
 */
export function seedOnBoot(store: InMemoryWebhookStore): void {
  for (const merchantId of SEEDED_MERCHANTS) {
    store.seed(merchantId, {
      ...EMPTY_LIVE_DATASET,
      transactions: [],
      openDisputes: { ...EMPTY_LIVE_DATASET.openDisputes },
    });
  }
}
