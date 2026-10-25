// Owner: R3 (exclusively). Task F-7 unit tests: degraded gates, obligations resolution,
// staging remainder arithmetic and the canonical breakdown structure.
import { describe, expect, it } from "vitest";
import { BREAKDOWN_LINE_CODES, MERCHANT_IDS } from "@surplus/contracts";
import {
  computeCashFlowSummary,
  computeSurplus,
  resolveObligations,
  type ComputeSurplusInput,
} from "./index";
import type { NormalizedTransaction } from "@surplus/contracts";

function row(
  monthBucket: string,
  overrides: Partial<NormalizedTransaction> = {},
): NormalizedTransaction {
  return {
    id: `t-${monthBucket}-${overrides.kind ?? "income"}`,
    merchantId: "live_sandbox",
    occurredAt: `${monthBucket}-05T12:00:00Z`,
    monthBucket: monthBucket,
    kind: "income",
    grossCents: 100000,
    feeCents: 0,
    netCents: 100000,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "a1b2c3d4",
    source: "fixture",
    ...overrides,
  };
}

function input(overrides: Partial<ComputeSurplusInput> = {}): ComputeSurplusInput {
  return {
    merchantId: "live_sandbox",
    transactions: [row("2026-01"), row("2026-02"), row("2026-03")],
    asOf: "2026-10-01T00:00:00Z",
    availableBalanceCents: 1450000,
    balanceSource: "PAYPAL_REPORTING_API",
    monthlyObligationsCents: 150000,
    riskProfile: "BALANCED",
    openDisputes: { count: 0, totalAmountCents: 0, unheldAmountCents: 0 },
    excludedNonUsdCount: 0,
    ...overrides,
  };
}

describe("surplus: OK case and staging remainders", () => {
  it("stages floor(safe / N) per tranche with the remainder going to tranche 1", () => {
    const result = computeSurplus(input({ availableBalanceCents: 1450001 }));
    // buffer 4.5? cv: nets [100000, 100000, 100000] -> cv 0 -> buffer 3.0 -> target 450000
    expect(result.bufferMonths).toBe(3);
    expect(result.bufferTargetCents).toBe(450000);
    expect(result.safeSurplusCents).toBe(1000001);
    expect(result.stagingScheduleCents).toEqual([250001, 250000, 250000, 250000]);
    expect(Math.round(result.stagingScheduleCents.reduce((a, b) => a + b, 0))).toBe(
      result.safeSurplusCents,
    );
    expect(result.modelStatus).toBe("OK");
    expect(result.stagingTrancheCount).toBe(4);
  });

  it("emits the canonical 10 breakdown lines in contract order", () => {
    const result = computeSurplus(input());
    expect(result.breakdownLines.map((line) => line.code)).toEqual([...BREAKDOWN_LINE_CODES]);
    expect(result.breakdownLines).toHaveLength(10);
    for (const line of result.breakdownLines) {
      // valueCents XOR valueScalar, per contract superRefine
      if (line.valueCents === undefined) {
        expect(line.valueScalar).toBeDefined();
      } else {
        expect(line.valueScalar).toBeUndefined();
      }
      expect(line.formulaText.length).toBeGreaterThan(0);
    }
  });
});

describe("surplus: gates", () => {
  it("INSUFFICIENT_DATA with fewer than 3 completed months: cv 0, buffer 9, safe 0", () => {
    const result = computeSurplus(
      input({
        transactions: [row("2026-09"), row("2026-08")],
      }),
    );
    expect(result.modelStatus).toBe("INSUFFICIENT_DATA");
    expect(result.cv).toBe(0);
    expect(result.bufferMonths).toBe(9);
    expect(result.bufferTargetCents).toBe(9 * 150000);
    expect(result.safeSurplusCents).toBe(0);
    expect(result.stagingScheduleCents).toEqual([0, 0, 0, 0]);
    expect(result.stagingTrancheCount).toBe(4);
  });

  it("per-profile staging tranche counts even in degraded statuses", () => {
    const result = computeSurplus(input({ riskProfile: "GROWTH", transactions: [row("2026-09")] }));
    expect(result.modelStatus).toBe("INSUFFICIENT_DATA");
    expect(result.stagingTrancheCount).toBe(3);
    expect(result.stagingScheduleCents).toEqual([0, 0, 0]);
  });

  it("OBLIGATIONS_REQUIRED with zero obligations: stats move, safe 0, target 0", () => {
    const result = computeSurplus(
      input({
        monthlyObligationsCents: 0,
        transactions: [
          row("2026-01", { grossCents: 160000, feeCents: 0, netCents: 160000 }),
          row("2026-02", { grossCents: 40000, feeCents: 0, netCents: 40000 }),
          row("2026-03", { grossCents: 100000, feeCents: 0, netCents: 100000 }),
        ],
      }),
    );
    expect(result.modelStatus).toBe("OBLIGATIONS_REQUIRED");
    expect(result.obligationsSource).toBe("USER_INPUT");
    expect(result.cv).toBe(0.6);
    expect(result.bufferMonths).toBe(6.6);
    expect(result.bufferTargetCents).toBe(0);
    expect(result.safeSurplusCents).toBe(0);
    expect(result.stagingScheduleCents).toEqual([0, 0, 0, 0]);
  });

  it("NEGATIVE_CASH_FLOW when the mean or baseline is non-positive: cv 1, buffer 9, safe 0", () => {
    const result = computeSurplus(
      input({
        transactions: [
          row("2026-01", {
            kind: "chargeback",
            grossCents: 5000000,
            feeCents: 0,
            netCents: -5000000,
          }),
          row("2026-02", { grossCents: 100000, feeCents: 0, netCents: 100000 }),
          row("2026-03", { grossCents: 100000, feeCents: 0, netCents: 100000 }),
        ],
      }),
    );
    expect(result.modelStatus).toBe("NEGATIVE_CASH_FLOW");
    expect(result.cv).toBe(1);
    expect(result.bufferMonths).toBe(9);
    expect(result.bufferTargetCents).toBe(9 * 150000);
    expect(result.safeSurplusCents).toBe(0);
  });

  it("does NOT stage anything when safe is exactly 0 in the OK branch", () => {
    const result = computeSurplus(
      input({
        availableBalanceCents: 450000,
        monthlyObligationsCents: 150000,
      }),
    );
    expect(result.modelStatus).toBe("OK");
    expect(result.safeSurplusCents).toBe(0);
    expect(result.stagingScheduleCents).toEqual([0, 0, 0, 0]);
  });
});

describe("surplus: obligations resolution", () => {
  it("prefers USER_INPUT over the trailing-3M withdrawal mean", () => {
    const result = computeSurplus(
      input({
        monthlyObligationsCents: 777777,
        transactions: [
          ...[0, 1, 2, 3, 4, 5, 6, 7, 8]
            .map((i) => rowMonthNth(2026 - Math.floor((11 - i) / 12), `${String(i % 12 || 12)}`))
            .slice(0, 0),
          row("2026-01"),
          row("2026-02"),
          row("2026-03"),
          row("2026-01", {
            kind: "withdrawal",
            grossCents: 999999,
            feeCents: 0,
            netCents: -999999,
          }),
          row("2026-02", {
            kind: "withdrawal",
            grossCents: 999999,
            feeCents: 0,
            netCents: -999999,
          }),
          row("2026-03", {
            kind: "withdrawal",
            grossCents: 999999,
            feeCents: 0,
            netCents: -999999,
          }),
        ],
      }),
    );
    expect(result.obligationsSource).toBe("USER_INPUT");
    expect(result.monthlyObligationsCents).toBe(777777);
  });

  it("falls back to round(total withdrawals across last 3 completed months / 3)", () => {
    const txs: NormalizedTransaction[] = [
      row("2026-01"),
      row("2026-02"),
      row("2026-03"),
      row("2026-07"),
    ];
    const summary = computeCashFlowSummary(input({ transactions: txs }));
    const resolved = resolveObligations(undefined, summary, txs);
    expect(resolved.obligationsSource).toBe("TRAILING_3M_WITHDRAWAL_AVG");
    // no withdrawal rows at all -> 0 -> OBLIGATIONS_REQUIRED gate applies downstream
    expect(resolved.monthlyObligationsCents).toBe(0);
  });

  it("counts only withdrawal gross in the last 3 series months (missing months = 0)", () => {
    const txs: NormalizedTransaction[] = [
      row("2026-01", { kind: "withdrawal", grossCents: 300000, feeCents: 0, netCents: -300000 }),
      row("2026-03", { kind: "withdrawal", grossCents: 600000, feeCents: 0, netCents: -600000 }),
      row("2026-07", { kind: "withdrawal", grossCents: 9000000, feeCents: 0, netCents: -9000000 }),
    ];
    const summary = computeCashFlowSummary(input({ transactions: txs }));
    const resolved = resolveObligations(undefined, summary, txs);
    // last 3 series buckets: 2026-07, 2026-08, 2026-09 -> only the outlier month counts
    expect(resolved.monthlyObligationsCents).toBe(Math.round(9000000 / 3));
  });

  it("rejects merchant ids outside the contract", () => {
    expect(MERCHANT_IDS.includes("persona_steady_retainer")).toBe(true);
    expect(() => computeSurplus(input({ merchantId: "hack" as never }))).toThrow();
  });
});

function rowMonthNth(year: number, month: string): NormalizedTransaction {
  return row(`${year}-${month}`);
}
