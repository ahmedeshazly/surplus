// Owner: R3 (exclusively). Task F-8 unit tests: scenario consistency checks and the +50%
// shock case verified during engine design (decisions in docs/decisions.md).
import { describe, expect, it } from "vitest";
import { runScenarioComparison } from "./scenarios";
import type { ScenarioInput } from "@surplus/contracts";
import type { ComputeSurplusInput } from "./surplus";
import { DEMO_LIVE_PAYMENT, buildDemoTransactions, DEMO_AS_OF } from "./golden.test";

const demoInput: ComputeSurplusInput = {
  merchantId: "live_sandbox",
  transactions: buildDemoTransactions(),
  asOf: DEMO_AS_OF,
  availableBalanceCents: 1850000,
  balanceSource: "PAYPAL_REPORTING_API",
  monthlyObligationsCents: 300000,
  riskProfile: "BALANCED",
  openDisputes: { count: 1, totalAmountCents: 40000, unheldAmountCents: 40000 },
  excludedNonUsdCount: 0,
};

const plus50: ScenarioInput = {
  merchantId: "live_sandbox",
  riskProfile: "BALANCED",
  monthlyObligationsCents: 300000,
  incomeShockPct: 50,
  delayedPaymentCents: 0,
  oneOffExpenseCents: 0,
};

describe("scenarios: consistency validation", () => {
  it("rejects a scenario whose merchantId differs from the base", () => {
    expect(() =>
      runScenarioComparison(demoInput, { ...plus50, merchantId: "persona_steady_retainer" }),
    ).toThrow(/merchantId/);
  });

  it("rejects a scenario whose riskProfile differs from the base", () => {
    expect(() => runScenarioComparison(demoInput, { ...plus50, riskProfile: "GROWTH" })).toThrow(
      /riskProfile/,
    );
  });

  it("rejects obligations that differ from the base's USER_INPUT value", () => {
    expect(() =>
      runScenarioComparison(demoInput, { ...plus50, monthlyObligationsCents: 310000 }),
    ).toThrow(/monthlyObligationsCents/);
  });

  it("rejects out-of-range shocks via the contract schema", () => {
    expect(() => runScenarioComparison(demoInput, { ...plus50, incomeShockPct: 51 })).toThrow();
    expect(() => runScenarioComparison(demoInput, { ...plus50, incomeShockPct: -81 })).toThrow();
  });
});

describe("scenarios: +50% income shock on the demo persona", () => {
  const result = runScenarioComparison(demoInput, plus50);

  it("keeps the baseline untouched", () => {
    expect(result.baselineSurplus.safeSurplusCents).toBe(420000);
    expect(result.baselineSurplus.bufferMonths).toBe(4.5);
    expect(result.scenarioInput.incomeShockPct).toBe(50);
  });

  it("lifts the stressed case exactly to the verified values", () => {
    expect(result.stressedSurplus.modelStatus).toBe("OK");
    expect(result.stressedSurplus.cv).toBe(0.2387);
    expect(result.stressedSurplus.bufferMonths).toBe(4.43);
    expect(result.stressedSurplus.bufferTargetCents).toBe(1329000);
    expect(result.stressedSurplus.riskReserveCents).toBe(80008);
    expect(result.stressedSurplus.safeSurplusCents).toBe(440992);
  });

  it("derives deltas and the reallocation plan from the stressed case", () => {
    expect(result.deltaSafeSurplusCents).toBe(20992);
    expect(result.deltaBufferMonths).toBe(-0.07);
    expect(result.stressedPlan.safeSurplusCents).toBe(440992);
    expect(result.stressedPlan.merchantId).toBe("live_sandbox");
    expect(
      result.stressedPlan.bands.find((b) => b.assetClass === "CASH_MMF")!.allocatedMidpointCents,
    ).toBe(132297);
    expect(
      result.stressedPlan.bands.find((b) => b.assetClass === "SHORT_TERM_BONDS")!
        .allocatedMidpointCents,
    ).toBe(132298);
    expect(
      result.stressedPlan.bands.find((b) => b.assetClass === "BROAD_EQUITY_INDEX")!
        .allocatedMidpointCents,
    ).toBe(176397);
  });
});

describe("scenarios: in-progress live rows are also shocked", () => {
  it("scales a live October income row the same way as completed rows", () => {
    // canonical post-payment timeline: asOf 2026-10-25, balance bumped by the live net
    const withLive: ComputeSurplusInput = {
      ...demoInput,
      transactions: [...demoInput.transactions, DEMO_LIVE_PAYMENT],
      asOf: "2026-10-25T10:00:00Z",
      availableBalanceCents: 1850000 + DEMO_LIVE_PAYMENT.netCents,
    };
    const result = runScenarioComparison(withLive, plus50);
    // baseline (unshocked, post-payment): safe 536470 (golden AppEvent value)
    expect(result.baselineSurplus.safeSurplusCents).toBe(536470);
    // The live row is untouched by the monthly model but the available balance carries it:
    // stressed safe = non-live stressed safe (440992) + the live net 116470 = 557462.
    expect(result.stressedSurplus.riskReserveCents).toBe(80008);
    expect(result.stressedSurplus.safeSurplusCents).toBe(557462);
    expect(result.deltaSafeSurplusCents).toBe(20992);
  });
});
