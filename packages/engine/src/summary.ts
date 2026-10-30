// Owner: R3 (exclusively). Task F-6. Deterministic cash-flow summary engine.
// Semantics locked in docs/decisions.md ("Engine decisions R3"):
// - Completed calendar months only (UTC buckets strictly before the month containing asOf);
//   the in-progress month never enters the monthly model.
// - Window totals (week/month/year) are trailing half-open windows [asOf - N days, asOf).
// - The 90-day refund-rate window is anchored to the start of the month containing asOf
//   (end of the last completed month), so live in-progress payments cannot distort the rate
//   and a live payment moves only the available balance (append-only demo arithmetic).
import type {
  CashFlowSummary,
  MerchantId,
  MonthlyNetPoint,
  NormalizedTransaction,
  OpenDisputesSummary,
  WindowTotals,
} from "@surplus/contracts";
import { clamp, linearSlope, mean, medianHalfUp, round4, sampleStdDev } from "./rounding";
import {
  addDaysUtc,
  completedMonthBuckets,
  currentMonthStartUtc,
  isCompletedMonthRow,
  parseIsoUtc,
  toIsoUtc,
  trailingWindowUtc,
} from "./months";
import {
  normalizeDisputes,
  requireIsoUtc,
  requireMerchantId,
  requireNonNegativeInt,
  requireTransactions,
} from "./validate";

export const WINDOW_DAYS = { week: 7, month: 30, year: 365 } as const;
export const REFUND_RATE_WINDOW_DAYS = 90;

export interface ComputeCashFlowSummaryInput {
  merchantId: MerchantId;
  transactions: NormalizedTransaction[];
  asOf: string;
  openDisputes?: OpenDisputesSummary;
  excludedNonUsdCount?: number;
}

interface MonthAgg {
  grossIncomeCents: number;
  feesCents: number;
  refundsCents: number;
  chargebacksCents: number;
  withdrawalsCents: number;
  transactionCount: number;
}

function emptyMonthAgg(): MonthAgg {
  return {
    grossIncomeCents: 0,
    feesCents: 0,
    refundsCents: 0,
    chargebacksCents: 0,
    withdrawalsCents: 0,
    transactionCount: 0,
  };
}

interface WindowAcc {
  grossIncomeCents: number;
  feesCents: number;
  refundsCents: number;
  chargebacksCents: number;
  withdrawalsCents: number;
  transactionCount: number;
}

function emptyWindowAcc(): WindowAcc {
  return {
    grossIncomeCents: 0,
    feesCents: 0,
    refundsCents: 0,
    chargebacksCents: 0,
    withdrawalsCents: 0,
    transactionCount: 0,
  };
}

function toWindowTotals(
  acc: WindowAcc,
  label: WindowTotals["windowLabel"],
  startIso: string,
  endIso: string,
): WindowTotals {
  return {
    windowLabel: label,
    startDate: startIso,
    endDate: endIso,
    grossIncomeCents: acc.grossIncomeCents,
    feesCents: acc.feesCents,
    refundsCents: acc.refundsCents,
    chargebacksCents: acc.chargebacksCents,
    withdrawalsCents: acc.withdrawalsCents,
    netCashFlowCents:
      acc.grossIncomeCents - acc.feesCents - acc.refundsCents - acc.chargebacksCents,
    transactionCount: acc.transactionCount,
  };
}

// Aggregation semantic (locked): gross income is the sum of grossCents of income rows;
// fees are the sum of feeCents across ALL completed rows; refunds and chargebacks are the
// sums of grossCents of their rows; withdrawals are tracked but never subtracted from the
// monthly net (the buffer already covers obligations from the balance).
function accRow(
  acc: {
    feesCents: number;
    grossIncomeCents: number;
    refundsCents: number;
    chargebacksCents: number;
    withdrawalsCents: number;
    transactionCount: number;
  },
  row: NormalizedTransaction,
): void {
  acc.transactionCount += 1;
  acc.feesCents += row.feeCents;
  if (row.kind === "income") acc.grossIncomeCents += row.grossCents;
  else if (row.kind === "refund") acc.refundsCents += row.grossCents;
  else if (row.kind === "chargeback") acc.chargebacksCents += row.grossCents;
  else if (row.kind === "withdrawal") acc.withdrawalsCents += row.grossCents;
}

export function computeCashFlowSummary(input: ComputeCashFlowSummaryInput): CashFlowSummary {
  const merchantId = requireMerchantId(input.merchantId);
  const transactions = requireTransactions(input.transactions);
  const asOf = requireIsoUtc(input.asOf);
  const excludedNonUsdCount = requireNonNegativeInt(
    input.excludedNonUsdCount ?? 0,
    "excludedNonUsdCount",
  );
  const openDisputes = normalizeDisputes(input.openDisputes);

  const asOfDate = parseIsoUtc(asOf);
  const asOfMs = asOfDate.getTime();
  const partialStart = currentMonthStartUtc(asOfDate);
  const week = trailingWindowUtc(asOfDate, WINDOW_DAYS.week);
  const month = trailingWindowUtc(asOfDate, WINDOW_DAYS.month);
  const year = trailingWindowUtc(asOfDate, WINDOW_DAYS.year);
  // Refund-rate window anchor (locked): [current month start - 90d, current month start).
  const refundEnd = partialStart.getTime();
  const refundStart = addDaysUtc(partialStart, -REFUND_RATE_WINDOW_DAYS).getTime();

  const windowAccs = {
    week: emptyWindowAcc(),
    month: emptyWindowAcc(),
    year: emptyWindowAcc(),
  };
  const refundAcc = emptyWindowAcc();
  const monthAggs = new Map<string, MonthAgg>();

  for (const row of transactions) {
    if (row.currency !== "USD") continue; // defensive: loader promises USD-only input
    if (row.status !== "COMPLETED") continue;
    const rowMs = parseIsoUtc(row.occurredAt).getTime();

    if (rowMs >= week.start.getTime() && rowMs < asOfMs) accRow(windowAccs.week, row);
    if (rowMs >= month.start.getTime() && rowMs < asOfMs) accRow(windowAccs.month, row);
    if (rowMs >= year.start.getTime() && rowMs < asOfMs) accRow(windowAccs.year, row);
    if (rowMs >= refundStart && rowMs < refundEnd) accRow(refundAcc, row);

    const bucket = row.monthBucket;
    if (isCompletedMonthRow(bucket, asOfDate)) {
      let agg = monthAggs.get(bucket);
      if (agg === undefined) {
        agg = emptyMonthAgg();
        monthAggs.set(bucket, agg);
      }
      agg.grossIncomeCents += row.kind === "income" ? row.grossCents : 0;
      agg.feesCents += row.feeCents;
      agg.refundsCents += row.kind === "refund" ? row.grossCents : 0;
      agg.chargebacksCents += row.kind === "chargeback" ? row.grossCents : 0;
      agg.withdrawalsCents += row.kind === "withdrawal" ? row.grossCents : 0;
      agg.transactionCount += 1;
    }
  }

  const completedBuckets: string[] = [];
  for (const bucket of monthAggs.keys()) {
    completedBuckets.push(bucket);
  }
  completedBuckets.sort((a, b) => a.localeCompare(b));
  const spanBuckets = completedMonthBuckets(completedBuckets, asOfDate);

  const monthlySeries: MonthlyNetPoint[] = spanBuckets.map((bucket) => {
    const agg = monthAggs.get(bucket);
    const grossIncomeCents = agg?.grossIncomeCents ?? 0;
    const feesCents = agg?.feesCents ?? 0;
    const refundsCents = agg?.refundsCents ?? 0;
    const chargebacksCents = agg?.chargebacksCents ?? 0;
    return {
      monthBucket: bucket,
      grossIncomeCents,
      feesCents,
      refundsCents,
      chargebacksCents,
      netCents: grossIncomeCents - feesCents - refundsCents - chargebacksCents,
    };
  });

  const nets = monthlySeries.map((p) => p.netCents);
  const completedMonthsCount = monthlySeries.length;
  const mu = mean(nets);
  const stdDev = sampleStdDev(nets);
  const baselineMonthlyNetCents = medianHalfUp(nets);

  let cv: number;
  if (completedMonthsCount < 3) {
    cv = 0;
  } else if (mu <= 0 || baselineMonthlyNetCents <= 0) {
    cv = 1;
  } else {
    cv = round4(stdDev / Math.max(mu, baselineMonthlyNetCents));
  }

  const refundDenominator = Math.max(refundAcc.grossIncomeCents, 1);
  const refundRate90d = round4(
    clamp((refundAcc.refundsCents + refundAcc.chargebacksCents) / refundDenominator, 0, 1),
  );

  return {
    merchantId,
    asOf,
    windows: {
      week: toWindowTotals(windowAccs.week, "week", toIsoUtc(week.start), toIsoUtc(week.end)),
      month: toWindowTotals(windowAccs.month, "month", toIsoUtc(month.start), toIsoUtc(month.end)),
      year: toWindowTotals(windowAccs.year, "year", toIsoUtc(year.start), toIsoUtc(year.end)),
    },
    monthlySeries,
    completedMonthsCount,
    baselineMonthlyNetCents,
    meanMonthlyNetCents: mu,
    stdDevMonthlyNetCents: stdDev,
    cv,
    trendSlopeCentsPerMonth: linearSlope(nets),
    refundRate90d,
    openDisputes,
    excludedNonUsdCount,
  };
}
