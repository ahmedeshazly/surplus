// Owner: R1. Task C-12: seed-on-boot adapter.
//
// TEMPORARY until R2's scripts/seed.ts runs the hybrid SQLite + Sandbox seed.
// For now this reseeds the in-memory webhook store from the dataset loader so
// a fresh Render instance has deterministic state on every boot.
import type { MerchantId } from "@surplus/contracts";
import type { DatasetLoader } from "./dataset";
import { exampleDatasetLoader } from "./dataset";
import type { InMemoryWebhookStore } from "./webhookStore";

export const SEEDED_MERCHANTS: readonly MerchantId[] = ["live_sandbox"];

/**
 * Seeds every merchant the in-memory store serves.
 * TODO(R2): call the real seed.ts (fixtures + live baseline) instead.
 */
export async function seedOnBoot(
  store: InMemoryWebhookStore,
  loadDataset: DatasetLoader = exampleDatasetLoader,
): Promise<void> {
  for (const merchantId of SEEDED_MERCHANTS) {
    store.seed(merchantId, await loadDataset(merchantId));
  }
}
