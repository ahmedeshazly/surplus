// Owner: R3 (exclusively). Task H-7 groundwork: fast-check property invariants. The engine
// must be deterministic and pure — for any valid input the output satisfies the money
// integrity invariants regardless of data shape. Determinism is asserted directly: the same
// input twice must produce deep-identical results.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeAllocationPlan, computeCashFlowSummary, computeSurplus } from "./index";
import { TRANCHES_BY_PROFILE } from "./surplus";
import type { ComputeSurplusInput } from "./surplus";
import type { NormalizedTransaction } from "@surplus/contracts";

const ENOUGH_AS_OF = "2027-03-01T00:00:00Z";

// Last-`count` month buckets ending at 2027-02 (all completed relative to ENOUGH_AS_OF).
function lastBuckets(count: number): string[] {
  const buckets: string[] = [];
  let year = 2027;
  let month = 2;
  for (let i = 0; i < count; i++) {
    buckets.push(`${year}-${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return buckets.reverse();
}

function row(
  id: number,
  bucket: string,
  kind: NormalizedTransaction["kind"],
  gross: number,
  fee: number,
): NormalizedTransaction {
  return {
    id: `prop-${id}`,
    merchantId: "live_sandbox",
    occurredAt: `${bucket}-05T12:00:00Z`,
    monthBucket: bucket,
    kind,
    grossCents: gross,
    feeCents: fee,
    netCents: gross - fee,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "a1b2c3d4",
    source: "fixture",
  };
}

// Deterministic pseudo-amounts keep the generator fast and reproducible; fc explores the
// shape (months count, profile, balance, obligations, dispute split), the engine must hold
// invariants for every one of them.
function amountsFor(seed: number, index: number): { gross: number; fee: number } {
  const gross = (((seed * 37 + index * 91 + 31) % 41) + 1) * 10000;
  const fee = gross % 4000;
  return { gross, fee };
}

const inputArb: fc.Arbitrary<ComputeSurplusInput> = fc
  .record({
    months: fc.integer({ min: 0, max: 24 }),
    seed: fc.integer({ min: 1, max: 9999 }),
    balance: fc.integer({ min: 0, max: 20_000_000 }),
    profile: fc.constantFrom("CONSERVATIVE", "BALANCED", "GROWTH"),
    obligations: fc.option(fc.integer({ min: 0, max: 2_000_000 }), { nil: undefined }),
    held: fc.integer({ min: 0, max: 100 }),
  })
  .map(({ months, seed, balance, profile, obligations, held }) => {
    const transactions: NormalizedTransaction[] = [];
    let id = 0;
    for (const bucket of lastBuckets(months)) {
      const income = amountsFor(seed, id);
      id += 1;
      transactions.push(row(id - 1, bucket, "income", income.gross, income.fee));
      if (id % 3 === 0) {
        const withdrawal = amountsFor(seed, id);
        transactions.push(row(id, bucket, "withdrawal", withdrawal.gross, 0));
        id += 1;
      }
      if (id % 7 === 0) {
        transactions.push(row(id, bucket, "refund", 22000, 0));
        id += 1;
      }
    }
    const disputeCount = held === 0 ? 0 : held % 4;
    const total = disputeCount * 30000;
    return {
      merchantId: "live_sandbox",
      transactions,
      asOf: ENOUGH_AS_OF,
      availableBalanceCents: balance,
      balanceSource: "PAYPAL_REPORTING_API",
      monthlyObligationsCents: obligations,
      riskProfile: profile as ComputeSurplusInput["riskProfile"],
      openDisputes: {
        count: disputeCount,
        totalAmountCents: total,
        unheldAmountCents: Math.min(total, Math.floor(total / 2 / 1000) * 1000),
      },
      excludedNonUsdCount: 0,
    } satisfies ComputeSurplusInput;
  });

describe("property: invariants over 750 random valid inputs", () => {
  it("staging schedule sums exactly to safe surplus, matching the profile tranche count", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const surplus = computeSurplus(input);
        expect(surplus.stagingScheduleCents).toHaveLength(TRANCHES_BY_PROFILE[surplus.riskProfile]);
        expect(surplus.stagingScheduleCents.reduce((a, b) => a + b, 0)).toBe(
          surplus.safeSurplusCents,
        );
        expect(surplus.safeSurplusCents).toBeGreaterThanOrEqual(0);
        for (const cents of surplus.stagingScheduleCents) {
          expect(cents).toBeGreaterThanOrEqual(0);
          // tranches are equal except tranche 1, which absorbs the floor remainder
          expect(cents).toBeLessThanOrEqual(surplus.stagingScheduleCents[0]!);
        }
      }),
      { numRuns: 250 },
    );
  });

  it("allocation bands sum exactly to safe surplus with non-negative cash and valid pct ranges", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const surplus = computeSurplus(input);
        const plan = computeAllocationPlan(surplus);
        expect(plan.bands.reduce((acc, b) => acc + b.allocatedMidpointCents, 0)).toBe(
          plan.safeSurplusCents,
        );
        for (const band of plan.bands) {
          expect(band.allocatedMidpointCents).toBeGreaterThanOrEqual(0);
          expect(band.minPct).toBeLessThanOrEqual(band.targetMidpointPct);
          expect(band.targetMidpointPct).toBeLessThanOrEqual(band.maxPct);
        }
        if (plan.highVolatilityShiftApplied) {
          expect(surplus.cv).toBeGreaterThan(0.6);
        }
        expect(plan.safeSurplusCents).toBe(surplus.safeSurplusCents);
        expect(plan.stagingSchedule.reduce((acc, s) => acc + s.amountCents, 0)).toBe(
          plan.safeSurplusCents,
        );
      }),
      { numRuns: 250 },
    );
  });

  it("safe never exceeds available; buffer stays in [3, 9] when stats are live; gates pin safe to 0", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const surplus = computeSurplus(input);
        expect(surplus.safeSurplusCents).toBeLessThanOrEqual(surplus.availableBalanceCents);
        if (surplus.modelStatus === "OK") {
          expect(surplus.bufferMonths).toBeGreaterThanOrEqual(3);
          expect(surplus.bufferMonths).toBeLessThanOrEqual(9);
          expect(surplus.bufferTargetCents).toBe(
            Math.round(surplus.bufferMonths * surplus.monthlyObligationsCents),
          );
        } else {
          // degraded gates always pin safe to zero
          expect(surplus.safeSurplusCents).toBe(0);
        }
        expect(Number.isFinite(surplus.cv)).toBe(true);
        expect(surplus.cv).toBeGreaterThanOrEqual(0);
        // cv can exceed 1.0 for heavy outliers (sample std / mean of 3 months); the buffer
        // clamp to 9 months is what contains it.
        if (surplus.cv > 1 && surplus.modelStatus === "OK") {
          expect(surplus.bufferMonths).toBeLessThanOrEqual(9);
        }
      }),
      { numRuns: 250 },
    );
  });

  it("is deterministic: identical inputs produce deep-identical outputs", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const one = computeSurplus(input);
        const two = computeSurplus(input);
        expect(two).toEqual(one);
        expect(computeAllocationPlan(one)).toEqual(computeAllocationPlan(two));
      }),
      { numRuns: 100 },
    );
  });

  it("monthly series obeys net = gross - fees - refunds - chargebacks everywhere", () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const summary = computeCashFlowSummary(input);
        for (const point of summary.monthlySeries) {
          expect(point.netCents).toBe(
            point.grossIncomeCents - point.feesCents - point.refundsCents - point.chargebacksCents,
          );
        }
        expect(summary.monthlySeries.every((p) => p.monthBucket.length === 7)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});
