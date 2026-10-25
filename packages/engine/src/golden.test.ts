// Owner: R3 (exclusively). Task H-7 groundwork: golden tests locking the engine to the
// frozen example payloads from @surplus/contracts/examples (two-way lock: the payloads were
// generated from the exact demo dataset built here, and these tests fail the moment either
// side drifts without an explicit re-freeze).
import { describe, expect, it } from "vitest";
import type { NormalizedTransaction } from "@surplus/contracts";
import {
  exampleAllocationPlan,
  exampleAppEvent,
  exampleCashFlowSummary,
  exampleScenarioComparisonResult,
  exampleScenarioInput,
  exampleSurplusResult,
} from "@surplus/contracts/examples";
import {
  computeAllocationPlan,
  computeCashFlowSummary,
  computeSurplus,
  runScenarioComparison,
} from "./index";

export const DEMO_AS_OF = "2026-10-01T00:00:00Z";

const DEMO_MONTHS = [
  { bucket: "2025-10", income: 205000, fee: 3000 },
  { bucket: "2025-11", income: 121000, fee: 3000 },
  { bucket: "2025-12", income: 205000, fee: 3000 },
  { bucket: "2026-01", income: 163000, fee: 3000 },
  { bucket: "2026-02", income: 121000, fee: 3000 },
  { bucket: "2026-03", income: 205000, fee: 3000 },
  { bucket: "2026-04", income: 163000, fee: 3000 },
  { bucket: "2026-05", income: 121000, fee: 3000 },
  { bucket: "2026-06", income: 205000, fee: 3000 },
  { bucket: "2026-07", income: 256000, fee: 4000 },
  { bucket: "2026-08", income: 162000, fee: 4000 },
  { bucket: "2026-09", income: 182000, fee: 4000 },
] as const;

const REFUNDS: Record<string, { day: string; amount: number }> = {
  "2026-07": { day: "20", amount: 50000 },
  "2026-08": { day: "20", amount: 40000 },
  "2026-09": { day: "18", amount: 40000 },
};

export function buildDemoTransactions(): NormalizedTransaction[] {
  const txs: NormalizedTransaction[] = [];
  for (const m of DEMO_MONTHS) {
    txs.push({
      id: `fix-ls-${m.bucket}-income`,
      merchantId: "live_sandbox",
      occurredAt: `${m.bucket}-05T12:00:00Z`,
      monthBucket: m.bucket,
      kind: "income",
      grossCents: m.income,
      feeCents: m.fee,
      netCents: m.income - m.fee,
      currency: "USD",
      status: "COMPLETED",
      counterpartyHash: "a1b2c3d4",
      source: "fixture",
    });
    txs.push({
      id: `fix-ls-${m.bucket}-withdrawal`,
      merchantId: "live_sandbox",
      occurredAt: `${m.bucket}-15T09:00:00Z`,
      monthBucket: m.bucket,
      kind: "withdrawal",
      grossCents: 100000,
      feeCents: 0,
      netCents: -100000,
      currency: "USD",
      status: "COMPLETED",
      counterpartyHash: "e5f6a7b8",
      source: "fixture",
    });
    const refund = REFUNDS[m.bucket];
    if (refund) {
      txs.push({
        id: `fix-ls-${m.bucket}-refund`,
        merchantId: "live_sandbox",
        occurredAt: `${m.bucket}-${refund.day}T14:00:00Z`,
        monthBucket: m.bucket,
        kind: "refund",
        grossCents: refund.amount,
        feeCents: 0,
        netCents: -refund.amount,
        currency: "USD",
        status: "COMPLETED",
        counterpartyHash: "c3d4e5f6",
        source: "fixture",
      });
    }
  }
  txs.push({
    id: "fix-ls-2026-09-chargeback",
    merchantId: "live_sandbox",
    occurredAt: "2026-09-18T11:30:00Z",
    monthBucket: "2026-09",
    kind: "chargeback",
    grossCents: 20000,
    feeCents: 0,
    netCents: -20000,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "d4e5f6a7",
    source: "fixture",
  });
  return txs;
}

export const demoInput = {
  merchantId: "live_sandbox",
  transactions: buildDemoTransactions(),
  asOf: DEMO_AS_OF,
  availableBalanceCents: 1850000,
  balanceSource: "PAYPAL_REPORTING_API",
  monthlyObligationsCents: 300000,
  riskProfile: "BALANCED",
  openDisputes: { count: 1, totalAmountCents: 40000, unheldAmountCents: 40000 },
  excludedNonUsdCount: 0,
} as const;

export const DEMO_LIVE_PAYMENT: NormalizedTransaction = {
  id: "live-payment-1",
  merchantId: "live_sandbox",
  occurredAt: "2026-10-25T09:59:56Z",
  monthBucket: "2026-10",
  kind: "income",
  grossCents: 120000,
  feeCents: 3530,
  netCents: 116470,
  currency: "USD",
  status: "COMPLETED",
  counterpartyHash: "bdebcccc",
  source: "live",
};

describe("golden: demo persona matches frozen example payloads", () => {
  it("computeCashFlowSummary equals exampleCashFlowSummary", () => {
    expect(computeCashFlowSummary(demoInput)).toEqual(exampleCashFlowSummary);
  });

  it("computeSurplus equals exampleSurplusResult", () => {
    expect(computeSurplus(demoInput)).toEqual(exampleSurplusResult);
  });

  it("computeAllocationPlan equals exampleAllocationPlan", () => {
    const plan = computeAllocationPlan(computeSurplus(demoInput));
    expect(plan).toEqual(exampleAllocationPlan);
  });

  it("-30% scenario equals exampleScenarioComparisonResult", () => {
    expect(runScenarioComparison(demoInput, exampleScenarioInput)).toEqual(
      exampleScenarioComparisonResult,
    );
  });

  it("live payment event reproduces exampleAppEvent updated payloads", () => {
    const afterInput = {
      ...demoInput,
      transactions: [...demoInput.transactions, DEMO_LIVE_PAYMENT],
      asOf: exampleAppEvent.updatedSummary.asOf,
      availableBalanceCents: demoInput.availableBalanceCents + DEMO_LIVE_PAYMENT.netCents,
      balanceSource: "LIVE_WEBHOOK_ADJUSTED" as const,
    };
    expect(computeCashFlowSummary(afterInput)).toEqual(exampleAppEvent.updatedSummary);
    expect(computeSurplus(afterInput)).toEqual(exampleAppEvent.updatedSurplus);
  });
});
