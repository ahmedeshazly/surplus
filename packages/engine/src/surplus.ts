// Owner: R3 (exclusively). Task F-7. Deterministic surplus calculator: exact integer-cent
// money, canonical 10-line breakdown, exact-sum staging schedule. Formula order follows
// AGENT_CONTEXT.md Section 5.2; degraded-status semantics are locked in docs/decisions.md.
import type {
  BalanceSource,
  BreakdownLine,
  MerchantId,
  NormalizedTransaction,
  OpenDisputesSummary,
  RiskProfile,
  SurplusModelStatus,
  SurplusResult,
} from "@surplus/contracts";
import { SurplusResultSchema } from "@surplus/contracts";
import { clamp, round2 } from "./rounding";
import { currentMonthStartUtc, parseIsoUtc } from "./months";
import { computeCashFlowSummary } from "./summary";
import type { ComputeCashFlowSummaryInput } from "./summary";
import {
  normalizeDisputes,
  requireBalanceSource,
  requireIsoUtc,
  requireMerchantId,
  requireNonNegativeInt,
  requireRiskProfile,
  requireTransactions,
} from "./validate";

export interface ComputeSurplusInput {
  merchantId: MerchantId;
  transactions: NormalizedTransaction[];
  asOf: string;
  availableBalanceCents: number;
  balanceSource: BalanceSource;
  monthlyObligationsCents?: number;
  riskProfile: RiskProfile;
  openDisputes?: OpenDisputesSummary;
  excludedNonUsdCount?: number;
}

export const TRANCHES_BY_PROFILE: Record<RiskProfile, 3 | 4 | 6> = {
  CONSERVATIVE: 6,
  BALANCED: 4,
  GROWTH: 3,
};

const MIN_BUFFER_MONTHS = 3;
const MAX_BUFFER_MONTHS = 9;

export interface ObligationsResolution {
  monthlyObligationsCents: number;
  obligationsSource: "USER_INPUT" | "TRAILING_3M_WITHDRAWAL_AVG";
}

// Locked: a caller-supplied positive obligations value wins (USER_INPUT). If the caller omits
// the value, fall back to the mean of monthly withdrawal gross across the trailing 3 completed
// calendar months (missing months count as 0), rounded half-up to integer cents.
export function resolveObligations(
  supplied: number | undefined,
  summary: {
    monthlySeries: {
      monthBucket: string;
      grossIncomeCents: number;
      feesCents: number;
      refundsCents: number;
      chargebacksCents: number;
      netCents: number;
    }[];
    completedMonthsCount: number;
  },
  transactions: readonly NormalizedTransaction[],
): ObligationsResolution {
  if (supplied !== undefined) {
    return { monthlyObligationsCents: supplied, obligationsSource: "USER_INPUT" };
  }
  const lastThree = summary.monthlySeries.slice(-3).map((p) => p.monthBucket);
  const relevant = new Set(lastThree);
  let total = 0;
  for (const row of transactions) {
    if (row.status !== "COMPLETED" || row.kind !== "withdrawal") continue;
    if (!relevant.has(row.monthBucket)) continue;
    total += row.grossCents;
  }
  return {
    monthlyObligationsCents: Math.round(total / 3),
    obligationsSource: "TRAILING_3M_WITHDRAWAL_AVG",
  };
}

function buildBreakdownLines(values: {
  modelStatus: SurplusModelStatus;
  availableBalanceCents: number;
  balanceSource: BalanceSource;
  completedMonthsCount: number;
  baselineMonthlyNetCents: number;
  sampleStdDevCents: number;
  meanMonthlyNetCents: number;
  cv: number;
  bufferMonths: number;
  monthlyObligationsCents: number;
  bufferTargetCents: number;
  disputesCount: number;
  unheldOpenDisputesCents: number;
  refundsPlusChargebacks90d: number;
  income90dCents: number;
  refundRate90d: number;
  expectedRefundExposureCents: number;
  riskReserveCents: number;
  safeSurplusCents: number;
  stagingTrancheCount: number;
  stagingScheduleCents: number[];
}): BreakdownLine[] {
  const s = values;
  const maxBase = Math.max(s.meanMonthlyNetCents, s.baselineMonthlyNetCents);
  const refundDenominator = Math.max(s.income90dCents, 1);
  const maxBaseline = Math.max(s.baselineMonthlyNetCents, 0);
  const lines: BreakdownLine[] = [
    {
      code: "AVAILABLE_BALANCE",
      label: "Available PayPal balance",
      formulaText: `availableBalanceCents (source: ${s.balanceSource}) = ${s.availableBalanceCents}`,
      valueCents: s.availableBalanceCents,
      unit: "USD_CENTS",
    },
    {
      code: "BASELINE_MONTHLY_NET",
      label: "Baseline monthly net (median)",
      formulaText: `median(monthly net over ${s.completedMonthsCount} completed months) = ${s.baselineMonthlyNetCents}`,
      valueCents: s.baselineMonthlyNetCents,
      unit: "USD_CENTS",
    },
  ];

  if (s.completedMonthsCount < 3) {
    lines.push({
      code: "VOLATILITY_CV",
      label: "Income volatility (CV)",
      formulaText: `insufficient data: fewer than 3 completed months; CV pinned to 0 for display`,
      valueScalar: 0,
      unit: "RATIO",
    });
  } else if (s.meanMonthlyNetCents <= 0 || s.baselineMonthlyNetCents <= 0) {
    lines.push({
      code: "VOLATILITY_CV",
      label: "Income volatility (CV)",
      formulaText: `mean or baseline monthly net is not positive; CV pinned to 1.0000`,
      valueScalar: 1,
      unit: "RATIO",
    });
  } else {
    lines.push({
      code: "VOLATILITY_CV",
      label: "Income volatility (CV)",
      formulaText: `round4(sample std dev / max(mean, baseline)) = ${round2(s.sampleStdDevCents)} / ${maxBase} = ${s.cv}`,
      valueScalar: s.cv,
      unit: "RATIO",
    });
  }

  if (s.completedMonthsCount < 3 || s.modelStatus === "NEGATIVE_CASH_FLOW") {
    lines.push({
      code: "BUFFER_MONTHS",
      label: "Cash buffer runway",
      formulaText:
        s.completedMonthsCount < 3
          ? `pinned to the maximum ${s.bufferMonths} months until volatility is measurable`
          : `pinned to the maximum ${s.bufferMonths} months under negative cash flow`,
      valueScalar: s.bufferMonths,
      unit: "MONTHS",
    });
  } else {
    lines.push({
      code: "BUFFER_MONTHS",
      label: "Cash buffer runway",
      formulaText: `round2(clamp(3 + 6 * cv, 3, 9)) = clamp(3 + 6 * ${s.cv}, 3, 9) = ${s.bufferMonths}`,
      valueScalar: s.bufferMonths,
      unit: "MONTHS",
    });
  }

  if (s.modelStatus === "OBLIGATIONS_REQUIRED") {
    lines.push({
      code: "BUFFER_TARGET",
      label: "Cash buffer target",
      formulaText: `no monthly obligations available; buffer target pinned to 0`,
      valueCents: 0,
      unit: "USD_CENTS",
    });
  } else {
    lines.push({
      code: "BUFFER_TARGET",
      label: "Cash buffer target",
      formulaText: `round(bufferMonths * monthlyObligationsCents) = round(${s.bufferMonths} * ${s.monthlyObligationsCents}) = ${s.bufferTargetCents}`,
      valueCents: s.bufferTargetCents,
      unit: "USD_CENTS",
    });
  }

  lines.push(
    {
      code: "OPEN_DISPUTE_RESERVE",
      label: "Open dispute reserve (unheld)",
      formulaText: `unheld open dispute exposure not already withheld from the available balance (count: ${s.disputesCount}) = ${s.unheldOpenDisputesCents}`,
      valueCents: s.unheldOpenDisputesCents,
      unit: "USD_CENTS",
    },
    {
      code: "EXPECTED_REFUND_EXPOSURE",
      label: "Expected refund exposure (90-day rate)",
      formulaText: `round(round4(${s.refundsPlusChargebacks90d} / ${refundDenominator}, 4) * max(baseline, 0)) = round(${s.refundRate90d} * ${maxBaseline}) = ${s.expectedRefundExposureCents}`,
      valueCents: s.expectedRefundExposureCents,
      unit: "USD_CENTS",
    },
    {
      code: "TOTAL_RISK_RESERVE",
      label: "Total risk reserve",
      formulaText: `open dispute reserve + expected refund exposure = ${s.unheldOpenDisputesCents} + ${s.expectedRefundExposureCents} = ${s.riskReserveCents}`,
      valueCents: s.riskReserveCents,
      unit: "USD_CENTS",
    },
  );

  if (s.modelStatus === "OK") {
    lines.push({
      code: "SAFE_SURPLUS",
      label: "Safe-to-invest surplus",
      formulaText: `max(0, available balance - buffer target - risk reserve) = max(0, ${s.availableBalanceCents} - ${s.bufferTargetCents} - ${s.riskReserveCents}) = ${s.safeSurplusCents}`,
      valueCents: s.safeSurplusCents,
      unit: "USD_CENTS",
    });
  } else if (s.modelStatus === "INSUFFICIENT_DATA") {
    lines.push({
      code: "SAFE_SURPLUS",
      label: "Safe-to-invest surplus",
      formulaText: `insufficient data: fewer than 3 completed months; surplus pinned to 0`,
      valueCents: 0,
      unit: "USD_CENTS",
    });
  } else if (s.modelStatus === "OBLIGATIONS_REQUIRED") {
    lines.push({
      code: "SAFE_SURPLUS",
      label: "Safe-to-invest surplus",
      formulaText: `monthly obligations are required before a surplus can be computed; surplus pinned to 0`,
      valueCents: 0,
      unit: "USD_CENTS",
    });
  } else {
    lines.push({
      code: "SAFE_SURPLUS",
      label: "Safe-to-invest surplus",
      formulaText: `mean or baseline monthly net is not positive; surplus pinned to 0`,
      valueCents: 0,
      unit: "USD_CENTS",
    });
  }

  if (s.modelStatus === "OK") {
    lines.push({
      code: "STAGED_MONTHLY_TRANCHE",
      label: "First staging tranche",
      formulaText: `floor(safe surplus / ${s.stagingTrancheCount}) with remainder added to tranche 1 (of ${s.stagingTrancheCount}), executeAfterDays = (k - 1) * 30 = ${s.stagingScheduleCents[0] ?? 0}`,
      valueCents: s.stagingScheduleCents[0] ?? 0,
      unit: "USD_CENTS",
    });
  } else {
    lines.push({
      code: "STAGED_MONTHLY_TRANCHE",
      label: "First staging tranche",
      formulaText: `no surplus to stage; all ${s.stagingTrancheCount} tranches are 0`,
      valueCents: 0,
      unit: "USD_CENTS",
    });
  }

  return lines;
}

function buildStagingCents(safeSurplusCents: number, trancheCount: number): number[] {
  if (safeSurplusCents <= 0) {
    return Array<number>(trancheCount).fill(0);
  }
  const base = Math.floor(safeSurplusCents / trancheCount);
  const remainder = safeSurplusCents % trancheCount;
  const schedule: number[] = [];
  for (let k = 1; k <= trancheCount; k++) {
    schedule.push(k === 1 ? base + remainder : base);
  }
  return schedule;
}

export function computeSurplus(input: ComputeSurplusInput): SurplusResult {
  const merchantId = requireMerchantId(input.merchantId);
  const riskProfile = requireRiskProfile(input.riskProfile);
  const balanceSource = requireBalanceSource(input.balanceSource);
  const availableBalanceCents = requireNonNegativeInt(
    input.availableBalanceCents,
    "availableBalanceCents",
  );
  const asOf = requireIsoUtc(input.asOf);
  const transactions = requireTransactions(input.transactions);
  const openDisputes = normalizeDisputes(input.openDisputes);
  if (input.monthlyObligationsCents !== undefined) {
    requireNonNegativeInt(input.monthlyObligationsCents, "monthlyObligationsCents");
  }
  const excludedNonUsdCount = requireNonNegativeInt(
    input.excludedNonUsdCount ?? 0,
    "excludedNonUsdCount",
  );

  const summaryInput: ComputeCashFlowSummaryInput = {
    merchantId,
    transactions,
    asOf,
    openDisputes,
    excludedNonUsdCount,
  };
  const summary = computeCashFlowSummary(summaryInput);
  const obligations = resolveObligations(input.monthlyObligationsCents, summary, transactions);

  const trancheCount = TRANCHES_BY_PROFILE[riskProfile];
  const unheldOpenDisputesCents = openDisputes.unheldAmountCents;
  const maxBaseline = Math.max(summary.baselineMonthlyNetCents, 0);
  const expectedRefundExposureCents = Math.round(summary.refundRate90d * maxBaseline);

  let modelStatus: SurplusModelStatus;
  let cv: number;
  let bufferMonths: number;
  let bufferTargetCents: number;
  let safeSurplusCents: number;

  if (summary.completedMonthsCount < 3) {
    modelStatus = "INSUFFICIENT_DATA";
    cv = summary.cv;
    bufferMonths = MAX_BUFFER_MONTHS;
    bufferTargetCents = Math.round(MAX_BUFFER_MONTHS * obligations.monthlyObligationsCents);
    safeSurplusCents = 0;
  } else if (obligations.monthlyObligationsCents <= 0) {
    modelStatus = "OBLIGATIONS_REQUIRED";
    cv = summary.cv;
    bufferMonths = round2(clamp(3 + 6 * cv, MIN_BUFFER_MONTHS, MAX_BUFFER_MONTHS));
    bufferTargetCents = 0;
    safeSurplusCents = 0;
  } else if (summary.meanMonthlyNetCents <= 0 || summary.baselineMonthlyNetCents <= 0) {
    modelStatus = "NEGATIVE_CASH_FLOW";
    cv = 1;
    bufferMonths = MAX_BUFFER_MONTHS;
    bufferTargetCents = Math.round(MAX_BUFFER_MONTHS * obligations.monthlyObligationsCents);
    safeSurplusCents = 0;
  } else {
    modelStatus = "OK";
    cv = summary.cv;
    bufferMonths = round2(clamp(3 + 6 * cv, MIN_BUFFER_MONTHS, MAX_BUFFER_MONTHS));
    bufferTargetCents = Math.round(bufferMonths * obligations.monthlyObligationsCents);
    safeSurplusCents = Math.max(
      0,
      availableBalanceCents -
        bufferTargetCents -
        unheldOpenDisputesCents -
        expectedRefundExposureCents,
    );
  }

  const riskReserveCents = unheldOpenDisputesCents + expectedRefundExposureCents;
  const stagingScheduleCents = buildStagingCents(safeSurplusCents, trancheCount);
  const refundWindowInputs = refundRateWindowInputs(transactions, asOf);

  const surplus: SurplusResult = {
    merchantId,
    modelStatus,
    availableBalanceCents,
    balanceSource,
    monthlyObligationsCents: obligations.monthlyObligationsCents,
    obligationsSource: obligations.obligationsSource,
    riskProfile,
    cv,
    bufferMonths,
    bufferTargetCents,
    riskReserveCents,
    safeSurplusCents,
    stagingTrancheCount: trancheCount,
    stagingScheduleCents,
    breakdownLines: buildBreakdownLines({
      modelStatus,
      availableBalanceCents,
      balanceSource,
      completedMonthsCount: summary.completedMonthsCount,
      baselineMonthlyNetCents: summary.baselineMonthlyNetCents,
      sampleStdDevCents: summary.stdDevMonthlyNetCents,
      meanMonthlyNetCents: summary.meanMonthlyNetCents,
      cv,
      bufferMonths,
      monthlyObligationsCents: obligations.monthlyObligationsCents,
      bufferTargetCents,
      disputesCount: openDisputes.count,
      unheldOpenDisputesCents,
      refundsPlusChargebacks90d: refundWindowInputs.numerator,
      income90dCents: refundWindowInputs.incomeCents,
      refundRate90d: summary.refundRate90d,
      expectedRefundExposureCents,
      riskReserveCents,
      safeSurplusCents,
      stagingTrancheCount: trancheCount,
      stagingScheduleCents,
    }),
  };

  return SurplusResultSchema.parse(surplus);
}

// Raw 90-day refund-window numerators for the breakdown formula text (locked window anchor:
// [current month start - 90d, current month start)).
function refundRateWindowInputs(
  transactions: readonly NormalizedTransaction[],
  asOf: string,
): { numerator: number; incomeCents: number } {
  const asOfDate = parseIsoUtc(asOf);
  const end = currentMonthStartUtc(asOfDate).getTime();
  const start = end - 90 * 86_400_000;
  let numerator = 0;
  let incomeCents = 0;
  for (const row of transactions) {
    if (row.currency !== "USD" || row.status !== "COMPLETED") continue;
    const t = parseIsoUtc(row.occurredAt).getTime();
    if (t < start || t >= end) continue;
    if (row.kind === "refund" || row.kind === "chargeback") numerator += row.grossCents;
    if (row.kind === "income") incomeCents += row.grossCents;
  }
  return { numerator, incomeCents };
}
