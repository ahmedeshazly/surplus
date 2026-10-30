// Owner: R3 (exclusively). Task F-6 unit tests: window boundaries, the anchored 90-day
// refund-rate window, status-row filtering and the in-progress-month exclusion.
import { describe, expect, it } from "vitest";
import { computeCashFlowSummary } from "./summary";
import type { NormalizedTransaction } from "@surplus/contracts";

function row(
  overrides: Partial<NormalizedTransaction> &
    Pick<NormalizedTransaction, "monthBucket" | "occurredAt">,
): NormalizedTransaction {
  return {
    id: `t-${overrides.id ?? overrides.kind}-${overrides.monthBucket}-${overrides.occurredAt}`,
    merchantId: "live_sandbox",
    kind: "income",
    grossCents: 100000,
    feeCents: 1000,
    netCents: 99000,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "a1b2c3d4",
    source: "fixture",
    ...overrides,
  };
}

const BASE = {
  merchantId: "live_sandbox" as const,
  asOf: "2026-10-01T00:00:00Z",
  availableBalanceCents: 500000,
  balanceSource: "PAYPAL_REPORTING_API" as const,
  openDisputes: { count: 0, totalAmountCents: 0, unheldAmountCents: 0 },
  excludedNonUsdCount: 0,
};

describe("summary: status rows", () => {
  it("aggregates COMPLETED rows in the monthly net (withdrawals excluded from net)", () => {
    const summary = computeCashFlowSummary({
      ...BASE,
      transactions: [
        row({ monthBucket: "2026-09", occurredAt: "2026-09-05T12:00:00Z", kind: "income" }),
        row({
          monthBucket: "2026-09",
          occurredAt: "2026-09-15T09:00:00Z",
          kind: "withdrawal",
          grossCents: 40000,
          feeCents: 0,
          netCents: -40000,
        }),
        row({
          monthBucket: "2026-09",
          occurredAt: "2026-09-18T09:00:00Z",
          kind: "refund",
          grossCents: 20000,
          feeCents: 0,
          netCents: -20000,
        }),
        row({
          monthBucket: "2026-09",
          occurredAt: "2026-09-18T10:00:00Z",
          kind: "chargeback",
          grossCents: 5000,
          feeCents: 0,
          netCents: -5000,
        }),
      ],
    });
    expect(summary.monthlySeries).toHaveLength(1);
    const point = summary.monthlySeries[0]!;
    expect(point).toEqual({
      monthBucket: "2026-09",
      grossIncomeCents: 100000,
      feesCents: 1000,
      refundsCents: 20000,
      chargebacksCents: 5000,
      netCents: 74000,
    });
  });

  it("ignores PENDING / REVERSED rows for the monthly model and window counts", () => {
    const summary = computeCashFlowSummary({
      ...BASE,
      transactions: [
        row({ monthBucket: "2026-09", occurredAt: "2026-09-05T12:00:00Z", status: "PENDING" }),
        row({ monthBucket: "2026-09", occurredAt: "2026-09-06T12:00:00Z", status: "REVERSED" }),
      ],
    });
    expect(summary.monthlySeries).toHaveLength(0);
    expect(summary.completedMonthsCount).toBe(0);
    expect(summary.windows.year.transactionCount).toBe(0);
    expect(summary.cv).toBe(0); // fewer than 3 completed months
  });

  it("defensively rejects non-USD rows via the contract schema", () => {
    expect(() =>
      computeCashFlowSummary({
        ...BASE,
        transactions: [
          row({ monthBucket: "2026-09", occurredAt: "2026-09-05T12:00:00Z" }),
          // @ts-expect-error currency is locked to USD by the contracts
          row({ monthBucket: "2026-09", occurredAt: "2026-09-06T12:00:00Z", currency: "EUR" }),
        ],
      }),
    ).toThrow(/currency/);
  });
});

describe("summary: window boundaries", () => {
  const txs = [
    // exactly at asOf: half-open windows EXCLUDE it
    row({ monthBucket: "2026-10", occurredAt: "2026-10-01T00:00:00Z" }),
    // week window [2026-09-24, 2026-10-01): row at 2026-09-23 is outside, 2026-09-24 is inside
    row({ monthBucket: "2026-09", occurredAt: "2026-09-23T23:59:59Z" }),
    row({ monthBucket: "2026-09", occurredAt: "2026-09-24T00:00:00Z" }),
  ];
  const summary = computeCashFlowSummary({ ...BASE, transactions: txs });

  it("start boundary inclusive, asOf boundary exclusive, week window", () => {
    expect(summary.windows.week.startDate).toBe("2026-09-24T00:00:00Z");
    expect(summary.windows.week.endDate).toBe("2026-10-01T00:00:00Z");
    expect(summary.windows.week.transactionCount).toBe(1);
    expect(summary.windows.week.grossIncomeCents).toBe(100000);
  });

  it("month window [asOf - 30d, asOf) covers all three rows", () => {
    expect(summary.windows.month.startDate).toBe("2026-09-01T00:00:00Z");
    expect(summary.windows.month.transactionCount).toBe(2);
  });

  it("year window [asOf - 365d, asOf) covers all COMPLETED rows", () => {
    expect(summary.windows.year.startDate).toBe("2025-10-01T00:00:00Z");
    expect(summary.windows.year.transactionCount).toBe(2);
  });

  it("the asOf-instant row never enters the completed monthly model", () => {
    expect(summary.monthlySeries).toHaveLength(1);
    expect(summary.monthlySeries[0]!.monthBucket).toBe("2026-09");
    expect(summary.monthlySeries[0]!.grossIncomeCents).toBe(200000);
  });
});

describe("summary: rows at or after asOf are future data", () => {
  it("a row after asOf enters neither windows nor the monthly model", () => {
    const summary = computeCashFlowSummary({
      ...BASE,
      transactions: [
        row({
          monthBucket: "2026-09",
          occurredAt: "2026-09-05T12:00:00Z",
          grossCents: 900000,
          feeCents: 30000,
          netCents: 870000,
        }),
        row({
          monthBucket: "2026-10",
          occurredAt: "2026-10-25T09:59:56Z",
          grossCents: 120000,
          feeCents: 3530,
          netCents: 116470,
        }),
      ],
    });
    expect(summary.windows.week.grossIncomeCents).toBe(0); // Sep 5 is > 7 days before asOf
    expect(summary.windows.month.grossIncomeCents).toBe(900000); // Sep 5 is inside the 30d window
    expect(summary.windows.year.grossIncomeCents).toBe(900000); // only the pre-asOf row
    expect(summary.monthlySeries[0]!.netCents).toBe(870000);
    expect(summary.monthlySeries).toHaveLength(1);
    expect(summary.completedMonthsCount).toBe(1);
    // The demo-style in-progress live payment (asOf inside the same month bucket) is covered
    // by the golden AppEvent test: payment moves the balance only.
  });

  it("the 90-day refund window is anchored to the current month's start, not asOf", () => {
    const summary = computeCashFlowSummary({
      ...BASE,
      transactions: [
        // refund inside [2026-07-03, 2026-10-01): counted; BEFORE with asOf-anchored windows too
        row({
          monthBucket: "2026-07",
          occurredAt: "2026-07-10T00:00:00Z",
          kind: "refund",
          grossCents: 40000,
          feeCents: 0,
          netCents: -40000,
        }),
        row({
          monthBucket: "2026-07",
          occurredAt: "2026-07-10T00:00:00Z",
          kind: "income",
          grossCents: 400000,
          feeCents: 10000,
          netCents: 390000,
        }),
        // refund outside (2026-06): still a completed month but NOT in the 90d rate window
        row({
          monthBucket: "2026-06",
          occurredAt: "2026-06-30T23:59:59Z",
          kind: "refund",
          grossCents: 999000,
          feeCents: 0,
          netCents: -999000,
        }),
      ],
    });
    expect(summary.refundRate90d).toBe(round4(40000 / 400000));
    expect(summary.monthlySeries).toHaveLength(2); // 2026-06..2026-07 (min..max with data)
    expect(summary.monthlySeries[0]!.monthBucket).toBe("2026-06");
    expect(summary.monthlySeries[0]!.refundsCents).toBe(999000);
    expect(summary.monthlySeries[1]!.netCents).toBe(350000); // 400000 - 10000 - 40000
  });
});

describe("summary: refund-rate anchor disambiguation", () => {
  it("anchors to the current month start even when asOf is mid-month", () => {
    // asOf 2026-10-15: naive asOf-90d window starts Jul 17, anchored window starts Jul 3.
    const summary = computeCashFlowSummary({
      ...BASE,
      asOf: "2026-10-15T00:00:00Z",
      transactions: [
        row({
          monthBucket: "2026-07",
          occurredAt: "2026-07-05T00:00:00Z",
          kind: "refund",
          grossCents: 40000,
          feeCents: 0,
          netCents: -40000,
        }),
        row({
          monthBucket: "2026-07",
          occurredAt: "2026-07-10T00:00:00Z",
          kind: "income",
          grossCents: 400000,
          feeCents: 10000,
          netCents: 390000,
        }),
      ],
    });
    expect(summary.refundRate90d).toBe(round4(40000 / 400000));
  });
});

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

describe("summary: cv guard and covariance", () => {
  it("uses the sample std / max(mean, baseline) and rounds to 4 decimals", () => {
    const summary = computeCashFlowSummary({
      ...BASE,
      transactions: [
        row({
          monthBucket: "2026-01",
          occurredAt: "2026-01-05T12:00:00Z",
          grossCents: 102000,
          feeCents: 2000,
          netCents: 100000,
        }),
        row({
          monthBucket: "2026-02",
          occurredAt: "2026-02-05T12:00:00Z",
          grossCents: 102000,
          feeCents: 2000,
          netCents: 100000,
        }),
        row({
          monthBucket: "2026-03",
          occurredAt: "2026-03-05T12:00:00Z",
          grossCents: 52000,
          feeCents: 2000,
          netCents: 50000,
        }),
      ],
    });
    // sample std of [100000, 100000, 50000] ~ 28867.51; mean 83333.33 -> cv ~ 0.3464
    expect(summary.cv).toBe(
      round4(summary.stdDevMonthlyNetCents / Math.max(83333.33333333333, 100000)),
    );
    expect(summary.trendSlopeCentsPerMonth).not.toBeNaN();
  });

  it("pins cv to exactly 1 when the mean OR the baseline is non-positive", () => {
    const summary = computeCashFlowSummary({
      ...BASE,
      transactions: [
        row({
          monthBucket: "2026-01",
          occurredAt: "2026-01-05T12:00:00Z",
          kind: "chargeback",
          grossCents: 15000000,
          feeCents: 0,
          netCents: -15000000,
        }),
        row({
          monthBucket: "2026-02",
          occurredAt: "2026-02-05T12:00:00Z",
          grossCents: 100000,
          feeCents: 0,
          netCents: 100000,
        }),
        row({
          monthBucket: "2026-03",
          occurredAt: "2026-03-05T12:00:00Z",
          grossCents: 100000,
          feeCents: 0,
          netCents: 100000,
        }),
      ],
    });
    expect(summary.meanMonthlyNetCents).toBeLessThan(0);
    expect(summary.cv).toBe(1);
  });

  it("cv is 0 with fewer than 3 completed months", () => {
    const summary = computeCashFlowSummary({
      ...BASE,
      transactions: [
        row({
          monthBucket: "2026-08",
          occurredAt: "2026-08-05T12:00:00Z",
          grossCents: 100000,
          feeCents: 0,
          netCents: 100000,
        }),
        row({
          monthBucket: "2026-09",
          occurredAt: "2026-09-05T12:00:00Z",
          grossCents: 16000000,
          feeCents: 0,
          netCents: 16000000,
        }),
      ],
    });
    expect(summary.completedMonthsCount).toBe(2);
    expect(summary.cv).toBe(0);
  });
});
