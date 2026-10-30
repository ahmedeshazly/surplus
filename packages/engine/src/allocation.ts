// Owner: R3 (exclusively). Task F-8. Deterministic allocation rules and staging plan.
// Band table from AGENT_CONTEXT.md Section 5.2 step 8. Locked decisions (docs/decisions.md):
// - The CV > 0.60 shift moves 10 percentage points from BROAD_EQUITY_INDEX to CASH_MMF:
//   min/max/target all shift by the same 10 points (equity clamped to >= 0) and bonds are
//   untouched; only the two shifted bands carry the HIGH_VOLATILITY_CV_SHIFT reason code.
// - The shift applies strictly above 0.60 (a CV of exactly 0.60 does not trigger it).
// - Band cents: bonds and equity get Math.round(target% x safeSurplusCents); CASH_MMF absorbs
//   the rounding remainder so the three bands sum exactly to safeSurplusCents (proven >= 0).
// - Staging entries carry executeAfterDays = (k - 1) * 30.
import type {
  AllocationBand,
  AllocationPlan,
  AllocationReasonCode,
  AssetClassCode,
  RiskProfile,
  StagingScheduleEntry,
  SurplusResult,
} from "@surplus/contracts";
import {
  AllocationPlanSchema,
  DISCLAIMER_ID_V1,
  DISCLAIMER_TEXT_V1,
  SurplusResultSchema,
} from "@surplus/contracts";

export const CV_SHIFT_THRESHOLD = 0.6;
export const CV_SHIFT_POINTS = 10;

interface BandSpec {
  minPct: number;
  maxPct: number;
  targetMidpointPct: number;
}

const ASSET_CLASS_LABELS: Record<AssetClassCode, string> = {
  CASH_MMF: "Cash and Money Market",
  SHORT_TERM_BONDS: "Short-Term Treasuries and Bonds",
  BROAD_EQUITY_INDEX: "Broad Diversified Equity Index",
};

const BASE_REASON: Record<RiskProfile, AllocationReasonCode> = {
  CONSERVATIVE: "BASE_CONSERVATIVE_BAND",
  BALANCED: "BASE_BALANCED_BAND",
  GROWTH: "BASE_GROWTH_BAND",
};

export const BASE_BANDS: Record<RiskProfile, Record<AssetClassCode, BandSpec>> = {
  CONSERVATIVE: {
    CASH_MMF: { minPct: 40, maxPct: 60, targetMidpointPct: 50 },
    SHORT_TERM_BONDS: { minPct: 30, maxPct: 40, targetMidpointPct: 35 },
    BROAD_EQUITY_INDEX: { minPct: 0, maxPct: 20, targetMidpointPct: 15 },
  },
  BALANCED: {
    CASH_MMF: { minPct: 20, maxPct: 40, targetMidpointPct: 30 },
    SHORT_TERM_BONDS: { minPct: 20, maxPct: 40, targetMidpointPct: 30 },
    BROAD_EQUITY_INDEX: { minPct: 30, maxPct: 50, targetMidpointPct: 40 },
  },
  GROWTH: {
    CASH_MMF: { minPct: 10, maxPct: 20, targetMidpointPct: 15 },
    SHORT_TERM_BONDS: { minPct: 10, maxPct: 30, targetMidpointPct: 20 },
    BROAD_EQUITY_INDEX: { minPct: 50, maxPct: 70, targetMidpointPct: 65 },
  },
};

// Band specs after the high-volatility shift (locked adjustments above).
export function bandSpecsFor(
  riskProfile: RiskProfile,
  cv: number,
): {
  specs: Record<AssetClassCode, BandSpec>;
  shifted: boolean;
} {
  const base = BASE_BANDS[riskProfile];
  if (cv <= CV_SHIFT_THRESHOLD) {
    return { specs: base, shifted: false };
  }
  const shifted: Record<AssetClassCode, BandSpec> = {
    CASH_MMF: {
      minPct: base.CASH_MMF.minPct + CV_SHIFT_POINTS,
      maxPct: base.CASH_MMF.maxPct + CV_SHIFT_POINTS,
      targetMidpointPct: base.CASH_MMF.targetMidpointPct + CV_SHIFT_POINTS,
    },
    SHORT_TERM_BONDS: { ...base.SHORT_TERM_BONDS },
    BROAD_EQUITY_INDEX: {
      minPct: Math.max(0, base.BROAD_EQUITY_INDEX.minPct - CV_SHIFT_POINTS),
      maxPct: Math.max(0, base.BROAD_EQUITY_INDEX.maxPct - CV_SHIFT_POINTS),
      targetMidpointPct: Math.max(0, base.BROAD_EQUITY_INDEX.targetMidpointPct - CV_SHIFT_POINTS),
    },
  };
  return { specs: shifted, shifted: true };
}

export function computeAllocationPlan(surplus: SurplusResult): AllocationPlan {
  const parsed = SurplusResultSchema.parse(surplus);
  const { specs, shifted } = bandSpecsFor(parsed.riskProfile, parsed.cv);
  const baseReason = BASE_REASON[parsed.riskProfile];
  const safe = parsed.safeSurplusCents;

  const order: AssetClassCode[] = ["CASH_MMF", "SHORT_TERM_BONDS", "BROAD_EQUITY_INDEX"];
  const bands: AllocationBand[] = order.map((assetClass) => {
    const spec = specs[assetClass];
    const reasonCode: AllocationReasonCode =
      shifted && assetClass !== "SHORT_TERM_BONDS" ? "HIGH_VOLATILITY_CV_SHIFT" : baseReason;
    return {
      assetClass,
      label: ASSET_CLASS_LABELS[assetClass],
      minPct: spec.minPct,
      maxPct: spec.maxPct,
      targetMidpointPct: spec.targetMidpointPct,
      allocatedMidpointCents: 0,
      reasonCode,
    };
  });

  const bonds = bands[1];
  const equity = bands[2];
  if (bonds === undefined || equity === undefined) {
    throw new Error("allocation bands must always contain three entries");
  }
  bonds.allocatedMidpointCents = Math.round((safe * bonds.targetMidpointPct) / 100);
  equity.allocatedMidpointCents = Math.round((safe * equity.targetMidpointPct) / 100);
  const cash = bands[0];
  if (cash === undefined) throw new Error("allocation bands must always contain cash");
  cash.allocatedMidpointCents = safe - bonds.allocatedMidpointCents - equity.allocatedMidpointCents;

  const stagingSchedule: StagingScheduleEntry[] = parsed.stagingScheduleCents.map(
    (amountCents, index) => ({
      trancheNumber: index + 1,
      executeAfterDays: index * 30,
      amountCents,
    }),
  );

  const plan: AllocationPlan = {
    merchantId: parsed.merchantId,
    riskProfile: parsed.riskProfile,
    safeSurplusCents: safe,
    highVolatilityShiftApplied: shifted,
    bands,
    stagingSchedule,
    disclaimerId: DISCLAIMER_ID_V1,
    disclaimerText: DISCLAIMER_TEXT_V1,
  };
  return AllocationPlanSchema.parse(plan);
}
