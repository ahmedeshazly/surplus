// Owner: R3 (exclusively). Task H-7 groundwork: persona snapshots locking the four
// risk-profile x gate behaviors verified during engine design (decisions in docs/decisions.md).
// steady_retainer also exercises the TRAILING_3M_WITHDRAWAL_AVG obligations default.
import { describe, expect, it } from "vitest";
import type { MerchantId, NormalizedTransaction, RiskProfile } from "@surplus/contracts";
import { computeAllocationPlan, computeSurplus, type ComputeSurplusInput } from "./index";

const PERSONA_AS_OF = "2026-09-02T00:00:00Z";

function baseTx(
  merchantId: MerchantId,
  bucket: string,
  overrides: Partial<NormalizedTransaction>,
): NormalizedTransaction {
  return {
    id: `fix-${merchantId}-${bucket}-${overrides.kind ?? "income"}`,
    merchantId,
    occurredAt: `${bucket}-05T12:00:00Z`,
    monthBucket: bucket,
    kind: "income",
    grossCents: 0,
    feeCents: 0,
    netCents: 0,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "a1b2c3d4",
    source: "fixture",
    ...overrides,
  };
}

function monthBuckets(): string[] {
  const buckets: string[] = [];
  let year = 2025;
  let month = 9;
  for (let i = 0; i < 12; i++) {
    buckets.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return buckets;
}

function personaInput(
  merchantId: MerchantId,
  riskProfile: RiskProfile,
  availableBalanceCents: number,
  monthlyObligationsCents: number | undefined,
  transactions: NormalizedTransaction[],
  openDisputes: { count: number; totalAmountCents: number; unheldAmountCents: number },
): ComputeSurplusInput {
  return {
    merchantId,
    transactions,
    asOf: PERSONA_AS_OF,
    availableBalanceCents,
    balanceSource: "PAYPAL_REPORTING_API",
    monthlyObligationsCents,
    riskProfile,
    openDisputes,
    excludedNonUsdCount: 0,
  };
}

function steadyRetainer(): ComputeSurplusInput {
  const transactions = monthBuckets().flatMap((bucket) => [
    baseTx("persona_steady_retainer", bucket, {
      kind: "income",
      grossCents: 480000,
      feeCents: 15000,
      netCents: 465000,
    }),
    baseTx("persona_steady_retainer", bucket, {
      kind: "withdrawal",
      grossCents: 200000,
      feeCents: 0,
      netCents: -200000,
      counterpartyHash: "e5f6a7b8",
    }),
  ]);
  // monthlyObligationsCents omitted on purpose: exercises the trailing-3M withdrawal mean.
  return personaInput("persona_steady_retainer", "CONSERVATIVE", 2500000, undefined, transactions, {
    count: 0,
    totalAmountCents: 0,
    unheldAmountCents: 0,
  });
}

function volatileFreelancer(): ComputeSurplusInput {
  const transactions = monthBuckets().flatMap((bucket, index) => {
    if (index % 2 === 0) {
      return [
        baseTx("persona_volatile_freelancer", bucket, {
          grossCents: 920000,
          feeCents: 20000,
          netCents: 900000,
        }),
        baseTx("persona_volatile_freelancer", bucket, {
          kind: "withdrawal",
          grossCents: 150000,
          feeCents: 0,
          netCents: -150000,
          counterpartyHash: "e5f6a7b8",
        }),
      ];
    }
    return [
      baseTx("persona_volatile_freelancer", bucket, {
        grossCents: 170000,
        feeCents: 20000,
        netCents: 150000,
      }),
      baseTx("persona_volatile_freelancer", bucket, {
        kind: "refund",
        grossCents: 30000,
        feeCents: 0,
        netCents: -30000,
        counterpartyHash: "c3d4e5f6",
      }),
      baseTx("persona_volatile_freelancer", bucket, {
        kind: "withdrawal",
        grossCents: 150000,
        feeCents: 0,
        netCents: -150000,
        counterpartyHash: "e5f6a7b8",
      }),
    ];
  });
  return personaInput("persona_volatile_freelancer", "BALANCED", 2000000, 200000, transactions, {
    count: 1,
    totalAmountCents: 25000,
    unheldAmountCents: 25000,
  });
}

function seasonalSeller(): ComputeSurplusInput {
  const nets = [
    700000, 800000, 900000, 700000, 300000, 120000, 30000, 120000, 180000, 420000, 620000, 880000,
  ];
  const refunds: Record<string, number> = {
    "2026-02": 30000,
    "2026-03": 60000,
    "2026-08": 45000,
  };
  const transactions = monthBuckets().flatMap((bucket, index) => {
    const feeCents = 12000;
    const refundCents = refunds[bucket] ?? 0;
    const incomeCents = nets[index]! + feeCents + refundCents;
    const rows: NormalizedTransaction[] = [
      baseTx("persona_seasonal_seller", bucket, {
        grossCents: incomeCents,
        feeCents: feeCents,
        netCents: incomeCents - feeCents,
      }),
    ];
    if (refundCents > 0) {
      rows.push(
        baseTx("persona_seasonal_seller", bucket, {
          kind: "refund",
          grossCents: refundCents,
          feeCents: 0,
          netCents: -refundCents,
          counterpartyHash: "c3d4e5f6",
        }),
      );
    }
    rows.push(
      baseTx("persona_seasonal_seller", bucket, {
        kind: "withdrawal",
        grossCents: 200000,
        feeCents: 0,
        netCents: -200000,
        counterpartyHash: "e5f6a7b8",
      }),
    );
    return rows;
  });
  return personaInput("persona_seasonal_seller", "GROWTH", 3000000, 250000, transactions, {
    count: 2,
    totalAmountCents: 60000,
    unheldAmountCents: 60000,
  });
}

function disputeSpike(): ComputeSurplusInput {
  const transactions = monthBuckets().flatMap((bucket, index) => {
    const rows: NormalizedTransaction[] = [
      baseTx("persona_dispute_spike", bucket, {
        grossCents: 210000,
        feeCents: 10000,
        netCents: 200000,
      }),
    ];
    if (index === 11) {
      // 2026-08: a $30,500.00 dispute wipes the month net to -$30,000.00.
      rows[0]!.netCents = 50000;
      rows[0]!.grossCents = 60000;
      rows.push(
        baseTx("persona_dispute_spike", bucket, {
          kind: "chargeback",
          grossCents: 3050000,
          feeCents: 0,
          netCents: -3050000,
          counterpartyHash: "d4e5f6a7",
        }),
      );
    }
    rows.push(
      baseTx("persona_dispute_spike", bucket, {
        kind: "withdrawal",
        grossCents: 150000,
        feeCents: 0,
        netCents: -150000,
        counterpartyHash: "e5f6a7b8",
      }),
    );
    return rows;
  });
  return personaInput("persona_dispute_spike", "BALANCED", 900000, 300000, transactions, {
    count: 3,
    totalAmountCents: 300000,
    unheldAmountCents: 125000,
  });
}

describe("snapshots: engine personas", () => {
  it("steady_retainer (CONSERVATIVE, default obligations has CV 0)", () => {
    const surplus = computeSurplus(steadyRetainer());
    expect(surplus.modelStatus).toBe("OK");
    expect(surplus.obligationsSource).toBe("TRAILING_3M_WITHDRAWAL_AVG");
    expect(computeSurplus(steadyRetainer())).toMatchSnapshot("steady-retainer-surplus");
    expect(computeAllocationPlan(surplus)).toMatchSnapshot("steady-retainer-plan");
  });

  it("volatile_freelancer (BALANCED, CV > 0.60 shift, refund exposure)", () => {
    const surplus = computeSurplus(volatileFreelancer());
    expect(computeSurplus(volatileFreelancer())).toMatchSnapshot("volatile-freelancer-surplus");
    expect(computeAllocationPlan(surplus)).toMatchSnapshot("volatile-freelancer-plan");
  });

  it("seasonal_seller (GROWTH, CV > 0.60 shift, mild refunds)", () => {
    const surplus = computeSurplus(seasonalSeller());
    expect(computeSurplus(seasonalSeller())).toMatchSnapshot("seasonal-seller-surplus");
    expect(computeAllocationPlan(surplus)).toMatchSnapshot("seasonal-seller-plan");
  });

  it("dispute_spike (BALANCED, NEGATIVE_CASH_FLOW gate)", () => {
    const surplus = computeSurplus(disputeSpike());
    expect(surplus.modelStatus).toBe("NEGATIVE_CASH_FLOW");
    expect(computeSurplus(disputeSpike())).toMatchSnapshot("dispute-spike-surplus");
    expect(computeAllocationPlan(surplus)).toMatchSnapshot("dispute-spike-plan");
  });
});
