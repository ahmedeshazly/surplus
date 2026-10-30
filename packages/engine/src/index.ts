// Owner: R3 (exclusively). Public barrel for @surplus/engine. Pure and synchronous:
// no network I/O, no database, no LLM, no hidden clock or randomness. Pass asOf in.
export {
  clamp,
  linearSlope,
  mean,
  medianHalfUp,
  round2,
  round4,
  sampleStdDev,
  sum,
} from "./rounding";
export {
  MS_PER_DAY,
  addDaysUtc,
  bucketFromIndex,
  bucketIndex,
  completedMonthBuckets,
  currentMonthStartUtc,
  isCompletedMonthRow,
  monthBucketOfDate,
  monthBucketOfIso,
  monthIndexOfDate,
  parseIsoUtc,
  toIsoUtc,
  trailingWindowUtc,
} from "./months";
export { REFUND_RATE_WINDOW_DAYS, WINDOW_DAYS, computeCashFlowSummary } from "./summary";
export type { ComputeCashFlowSummaryInput } from "./summary";
export { TRANCHES_BY_PROFILE, computeSurplus, resolveObligations } from "./surplus";
export type { ComputeSurplusInput, ObligationsResolution } from "./surplus";
export {
  CV_SHIFT_POINTS,
  CV_SHIFT_THRESHOLD,
  BASE_BANDS,
  bandSpecsFor,
  computeAllocationPlan,
} from "./allocation";
export { runScenarioComparison } from "./scenarios";
