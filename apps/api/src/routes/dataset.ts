// Owner: R1. Task F-9: temporary dataset adapter.
//
// TEMPORARY until R2 ships getMerchantDataset() in packages/paypal/src/sources.
// It returns the contracts example payload so the routes can be exercised end
// to end. The loader is injected into buildApp() so tests can supply a richer
// dataset and so the swap to R2's real module is a one-line change.
import type {
  BalanceSource,
  MerchantId,
  NormalizedTransaction,
  OpenDisputesSummary,
} from "@surplus/contracts";
import {
  DEMO_AS_OF,
  exampleNormalizedTransaction,
  exampleOpenDisputesSummary,
  exampleSurplusResult,
} from "@surplus/contracts/examples";

/**
 * Shape that R2's getMerchantDataset(merchantId) will return.
 * TODO(R2): replace this local interface with the exported type from
 * packages/paypal/src/sources once F-2/F-3/F-4 land on main.
 */
export interface MerchantDataset {
  transactions: NormalizedTransaction[];
  availableBalanceCents: number;
  balanceSource: BalanceSource;
  openDisputes: OpenDisputesSummary;
  excludedNonUsdCount: number;
}

export type DatasetLoader = (
  merchantId: MerchantId,
) => MerchantDataset | Promise<MerchantDataset>;

/**
 * Fixture personas use a fixed asOf so golden values stay reproducible.
 * live_sandbox tracks wall-clock time because it is adjusted by live webhooks.
 */
export function asOfFor(merchantId: MerchantId, now: Date = new Date()): string {
  return merchantId === "live_sandbox" ? now.toISOString() : DEMO_AS_OF;
}

/** TEMPORARY loader. Replaced by R2's getMerchantDataset on merge. */
export const exampleDatasetLoader: DatasetLoader = (merchantId) => ({
  transactions: [{ ...exampleNormalizedTransaction, merchantId }],
  availableBalanceCents: exampleSurplusResult.availableBalanceCents,
  balanceSource: "FIXTURE",
  openDisputes: exampleOpenDisputesSummary,
  excludedNonUsdCount: 0,
});
