// Owner: R3 (exclusively). Task F-8 unit tests: the band table, the strictly-greater 0.60
// CV shift boundary, cash absorbing the rounding remainder and the staging schedule.
import { describe, expect, it } from "vitest";
import { computeAllocationPlan, computeSurplus, type ComputeSurplusInput } from "./index";
import type { NormalizedTransaction } from "@surplus/contracts";

// nets [160010, 40000-?...] chosen so sample std == 60010 exactly -> cv = round4(0.6001).
function cvRow(monthBucket: string, netCents: number): NormalizedTransaction {
  return {
    id: `t-${monthBucket}-${netCents}`,
    merchantId: "live_sandbox",
    occurredAt: `${monthBucket}-05T12:00:00Z`,
    monthBucket: monthBucket,
    kind: "income",
    grossCents: netCents,
    feeCents: 0,
    netCents: netCents,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "a1b2c3d4",
    source: "fixture",
  };
}

function surplusInput(nets: number[]): ComputeSurplusInput {
  const months = ["2026-01", "2026-02", "2026-03"];
  return {
    merchantId: "live_sandbox",
    transactions: months.map((bucket, i) => cvRow(bucket, nets[i]!)),
    asOf: "2026-10-01T00:00:00Z",
    availableBalanceCents: 1450000,
    balanceSource: "PAYPAL_REPORTING_API",
    monthlyObligationsCents: 150000,
    riskProfile: "BALANCED",
    openDisputes: { count: 0, totalAmountCents: 0, unheldAmountCents: 0 },
    excludedNonUsdCount: 0,
  };
}

describe("allocation: CV shift boundary (strictly greater than 0.60)", () => {
  it("cv exactly 0.6000 keeps BASE_BALANCED_BAND targets (no shift)", () => {
    const plan = computeAllocationPlan(computeSurplus(surplusInput([160000, 40000, 100000])));
    const cash = plan.bands.find((b) => b.assetClass === "CASH_MMF")!;
    const bonds = plan.bands.find((b) => b.assetClass === "SHORT_TERM_BONDS")!;
    const equity = plan.bands.find((b) => b.assetClass === "BROAD_EQUITY_INDEX")!;
    expect(plan.highVolatilityShiftApplied).toBe(false);
    expect(cash.reasonCode).toBe("BASE_BALANCED_BAND");
    expect(bonds.reasonCode).toBe("BASE_BALANCED_BAND");
    expect(equity.reasonCode).toBe("BASE_BALANCED_BAND");
    expect(cash.targetMidpointPct).toBe(30);
    expect(bonds.targetMidpointPct).toBe(30);
    expect(equity.targetMidpointPct).toBe(40);
    // allocated cents: bonds/equity rounded, cash absorbs the remainder, exact sum
    expect(bonds.allocatedMidpointCents).toBe(Math.round(0.3 * plan.safeSurplusCents));
    expect(equity.allocatedMidpointCents).toBe(Math.round(0.4 * plan.safeSurplusCents));
    expect(cash.allocatedMidpointCents).toBe(
      plan.safeSurplusCents - bonds.allocatedMidpointCents - equity.allocatedMidpointCents,
    );
    expect(cash.minPct).toBe(20);
    expect(cash.maxPct).toBe(40);
  });

  it("cv exactly 0.6001 shifts cash +10 and equity -10, bonds untouched", () => {
    const plan = computeAllocationPlan(computeSurplus(surplusInput([160010, 39990, 100000])));
    const cash = plan.bands.find((b) => b.assetClass === "CASH_MMF")!;
    const bonds = plan.bands.find((b) => b.assetClass === "SHORT_TERM_BONDS")!;
    const equity = plan.bands.find((b) => b.assetClass === "BROAD_EQUITY_INDEX")!;
    expect(plan.highVolatilityShiftApplied).toBe(true);
    expect(cash.reasonCode).toBe("HIGH_VOLATILITY_CV_SHIFT");
    expect(equity.reasonCode).toBe("HIGH_VOLATILITY_CV_SHIFT");
    expect(bonds.reasonCode).toBe("BASE_BALANCED_BAND");
    expect(cash.targetMidpointPct).toBe(40);
    expect(cash.minPct).toBe(30);
    expect(cash.maxPct).toBe(50);
    expect(equity.targetMidpointPct).toBe(30);
    expect(bonds.targetMidpointPct).toBe(30);
    const sum = plan.bands.reduce((acc, b) => acc + b.allocatedMidpointCents, 0);
    expect(sum).toBe(plan.safeSurplusCents);
    expect(cash.allocatedMidpointCents).toBeGreaterThanOrEqual(0);
  });
});

describe("allocation: schedules and bands", () => {
  it("staging entries are exact-sum and spaced 30 days apart per tranche index", () => {
    const plan = computeAllocationPlan(computeSurplus(surplusInput([160010, 40000, 100000])));
    // cv 0.6001, buffer 6.6006 -> round2 6.6, target 990000, safe 460000
    expect(plan.safeSurplusCents).toBe(460000);
    expect(plan.stagingSchedule.map((s) => s.amountCents)).toEqual([
      115000, 115000, 115000, 115000,
    ]);
    expect(plan.stagingSchedule.map((s) => s.executeAfterDays)).toEqual([0, 30, 60, 90]);
    const scheduleSum = plan.stagingSchedule.reduce((acc, s) => acc + s.amountCents, 0);
    expect(scheduleSum).toBe(460000);
  });

  it("CONSERVATIVE keeps 6 tranches and GROWTH 3 with their own band specs", () => {
    const conservative = computeAllocationPlan(
      computeSurplus({ ...surplusInput([100000, 100000, 100000]), riskProfile: "CONSERVATIVE" }),
    );
    expect(conservative.stagingSchedule).toHaveLength(6);
    const cashC = conservative.bands.find((b) => b.assetClass === "CASH_MMF")!;
    expect(cashC.targetMidpointPct).toBe(50);
    expect(cashC.reasonCode).toBe("BASE_CONSERVATIVE_BAND");
    const growth = computeAllocationPlan(
      computeSurplus({ ...surplusInput([100000, 100000, 100000]), riskProfile: "GROWTH" }),
    );
    expect(growth.stagingSchedule).toHaveLength(3);
    const equityG = growth.bands.find((b) => b.assetClass === "BROAD_EQUITY_INDEX")!;
    expect(equityG.targetMidpointPct).toBe(65);
    expect(equityG.reasonCode).toBe("BASE_GROWTH_BAND");
  });
});
