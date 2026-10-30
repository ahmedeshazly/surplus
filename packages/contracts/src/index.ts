// Owner: R3 (exclusively). Task K-4. Frozen as v1.0 at Gate 0 (Oct 24, 2026).
// Source of truth: AGENT_CONTEXT.md Section 7. Every member imports these exact types, Zod
// schemas and example payloads. Never redefine or loosely copy a contract type.
// All money is signed integer cents. All timestamps are ISO-8601 UTC ("Z").
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const MoneyCentsSchema = z.number().int();
const NonNegativeMoneyCentsSchema = z.number().int().nonnegative();
const IsoUtcSchema = z.string().datetime();
const MonthBucketSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected 'YYYY-MM'");

export { MoneyCentsSchema, NonNegativeMoneyCentsSchema, IsoUtcSchema, MonthBucketSchema };

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

export const MerchantIdSchema = z.enum([
  "live_sandbox",
  "persona_steady_retainer",
  "persona_volatile_freelancer",
  "persona_seasonal_seller",
  "persona_dispute_spike",
]);
export type MerchantId = z.infer<typeof MerchantIdSchema>;
export const MERCHANT_IDS: readonly MerchantId[] = MerchantIdSchema.options;
export const LIVE_MERCHANT_ID: MerchantId = "live_sandbox";

export const TransactionKindSchema = z.enum([
  "income",
  "refund",
  "chargeback",
  "fee",
  "withdrawal",
  "other",
]);
export type TransactionKind = z.infer<typeof TransactionKindSchema>;

export const TransactionStatusSchema = z.enum(["COMPLETED", "PENDING", "REVERSED"]);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const CurrencySchema = z.literal("USD");

export const DataSourceTypeSchema = z.enum(["live", "fixture"]);
export type DataSourceType = z.infer<typeof DataSourceTypeSchema>;

export const RiskProfileSchema = z.enum(["CONSERVATIVE", "BALANCED", "GROWTH"]);
export type RiskProfile = z.infer<typeof RiskProfileSchema>;

export const SurplusModelStatusSchema = z.enum([
  "OK",
  "INSUFFICIENT_DATA",
  "OBLIGATIONS_REQUIRED",
  "NEGATIVE_CASH_FLOW",
]);
export type SurplusModelStatus = z.infer<typeof SurplusModelStatusSchema>;

export const AssetClassCodeSchema = z.enum(["CASH_MMF", "SHORT_TERM_BONDS", "BROAD_EQUITY_INDEX"]);
export type AssetClassCode = z.infer<typeof AssetClassCodeSchema>;
export const ASSET_CLASS_CODES: readonly AssetClassCode[] = AssetClassCodeSchema.options;

export const AllocationReasonCodeSchema = z.enum([
  "BASE_CONSERVATIVE_BAND",
  "BASE_BALANCED_BAND",
  "BASE_GROWTH_BAND",
  "HIGH_VOLATILITY_CV_SHIFT",
]);
export type AllocationReasonCode = z.infer<typeof AllocationReasonCodeSchema>;

export const ValidatorStatusSchema = z.enum(["PASSED", "REGENERATED_PASSED", "FALLBACK_TEMPLATE"]);
export type ValidatorStatus = z.infer<typeof ValidatorStatusSchema>;

export const BalanceSourceSchema = z.enum([
  "PAYPAL_REPORTING_API",
  "LIVE_WEBHOOK_ADJUSTED",
  "FIXTURE",
]);
export type BalanceSource = z.infer<typeof BalanceSourceSchema>;

export const ObligationsSourceSchema = z.enum(["USER_INPUT", "TRAILING_3M_WITHDRAWAL_AVG"]);
export type ObligationsSource = z.infer<typeof ObligationsSourceSchema>;

export const AdvisorToolNameSchema = z.enum([
  "get_cash_flow_summary",
  "get_surplus",
  "get_allocation_plan",
  "run_scenario",
  "paypal_mcp_list_transactions",
  "paypal_mcp_list_disputes",
]);
export type AdvisorToolName = z.infer<typeof AdvisorToolNameSchema>;

export const AppEventTypeSchema = z.enum([
  "payment.received",
  "refund.processed",
  "dispute.opened",
  "plan.updated",
]);
export type AppEventType = z.infer<typeof AppEventTypeSchema>;

export const DisclaimerIdSchema = z.literal("EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1");
export type DisclaimerId = z.infer<typeof DisclaimerIdSchema>;

export const DISCLAIMER_ID_V1: DisclaimerId = "EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1";

export const DISCLAIMER_TEXT_V1 =
  "Educational information only - not financial advice. Surplus explains your PayPal cash-flow " +
  "history and proposes an illustrative, staged plan for idle cash. Surplus does not move money, " +
  "does not name or recommend any security, and makes no representation about future returns. " +
  "Talk to a licensed financial professional before investing.";

export const WindowLabelSchema = z.enum(["week", "month", "year"]);
export type WindowLabel = z.infer<typeof WindowLabelSchema>;

export const BreakdownUnitSchema = z.enum(["USD_CENTS", "MONTHS", "RATIO"]);
export type BreakdownUnit = z.infer<typeof BreakdownUnitSchema>;

export const BreakdownLineCodeSchema = z.enum([
  "AVAILABLE_BALANCE",
  "BASELINE_MONTHLY_NET",
  "VOLATILITY_CV",
  "BUFFER_MONTHS",
  "BUFFER_TARGET",
  "OPEN_DISPUTE_RESERVE",
  "EXPECTED_REFUND_EXPOSURE",
  "TOTAL_RISK_RESERVE",
  "SAFE_SURPLUS",
  "STAGED_MONTHLY_TRANCHE",
]);
export type BreakdownLineCode = z.infer<typeof BreakdownLineCodeSchema>;
export const BREAKDOWN_LINE_CODES: readonly BreakdownLineCode[] = BreakdownLineCodeSchema.options;

// ---------------------------------------------------------------------------
// Data contracts
// ---------------------------------------------------------------------------

export const NormalizedTransactionSchema = z
  .object({
    id: z.string().min(1),
    merchantId: MerchantIdSchema,
    occurredAt: IsoUtcSchema,
    monthBucket: MonthBucketSchema,
    kind: TransactionKindSchema,
    grossCents: NonNegativeMoneyCentsSchema,
    feeCents: NonNegativeMoneyCentsSchema,
    netCents: MoneyCentsSchema,
    currency: CurrencySchema,
    status: TransactionStatusSchema,
    counterpartyHash: z.string().regex(/^[0-9a-f]{8}$/, "Expected 8 lowercase hex chars"),
    source: DataSourceTypeSchema,
  })
  .superRefine((tx, ctx) => {
    const d = new Date(tx.occurredAt);
    const expected = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (expected !== tx.monthBucket) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["monthBucket"],
        message: `monthBucket '${tx.monthBucket}' does not match occurredAt UTC month '${expected}'`,
      });
    }
  });
export type NormalizedTransaction = z.infer<typeof NormalizedTransactionSchema>;

export const WindowTotalsSchema = z.object({
  windowLabel: WindowLabelSchema,
  startDate: IsoUtcSchema,
  endDate: IsoUtcSchema,
  grossIncomeCents: NonNegativeMoneyCentsSchema,
  feesCents: NonNegativeMoneyCentsSchema,
  refundsCents: NonNegativeMoneyCentsSchema,
  chargebacksCents: NonNegativeMoneyCentsSchema,
  withdrawalsCents: NonNegativeMoneyCentsSchema,
  netCashFlowCents: MoneyCentsSchema,
  transactionCount: z.number().int().nonnegative(),
});
export type WindowTotals = z.infer<typeof WindowTotalsSchema>;

export const MonthlyNetPointSchema = z.object({
  monthBucket: MonthBucketSchema,
  grossIncomeCents: NonNegativeMoneyCentsSchema,
  feesCents: NonNegativeMoneyCentsSchema,
  refundsCents: NonNegativeMoneyCentsSchema,
  chargebacksCents: NonNegativeMoneyCentsSchema,
  netCents: MoneyCentsSchema,
});
export type MonthlyNetPoint = z.infer<typeof MonthlyNetPointSchema>;

export const OpenDisputesSummarySchema = z
  .object({
    count: z.number().int().nonnegative(),
    totalAmountCents: NonNegativeMoneyCentsSchema,
    unheldAmountCents: NonNegativeMoneyCentsSchema,
  })
  .superRefine((d, ctx) => {
    if (d.unheldAmountCents > d.totalAmountCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unheldAmountCents"],
        message: "unheldAmountCents cannot exceed totalAmountCents",
      });
    }
  });
export type OpenDisputesSummary = z.infer<typeof OpenDisputesSummarySchema>;

export const CashFlowSummarySchema = z.object({
  merchantId: MerchantIdSchema,
  asOf: IsoUtcSchema,
  windows: z.object({
    week: WindowTotalsSchema,
    month: WindowTotalsSchema,
    year: WindowTotalsSchema,
  }),
  monthlySeries: z.array(MonthlyNetPointSchema),
  completedMonthsCount: z.number().int().nonnegative(),
  baselineMonthlyNetCents: MoneyCentsSchema,
  meanMonthlyNetCents: z.number(),
  stdDevMonthlyNetCents: z.number(),
  cv: z.number(),
  trendSlopeCentsPerMonth: z.number(),
  refundRate90d: z.number(),
  openDisputes: OpenDisputesSummarySchema,
  excludedNonUsdCount: z.number().int().nonnegative(),
});
export type CashFlowSummary = z.infer<typeof CashFlowSummarySchema>;

export const BreakdownLineSchema = z
  .object({
    code: BreakdownLineCodeSchema,
    label: z.string().min(1),
    formulaText: z.string().min(1),
    valueCents: MoneyCentsSchema.optional(),
    valueScalar: z.number().optional(),
    unit: BreakdownUnitSchema,
  })
  .superRefine((line, ctx) => {
    const hasCents = line.valueCents !== undefined;
    const hasScalar = line.valueScalar !== undefined;
    if (hasCents === hasScalar) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valueCents"],
        message: "Exactly one of valueCents or valueScalar must be present",
      });
    }
  });
export type BreakdownLine = z.infer<typeof BreakdownLineSchema>;

export const StagingTrancheCountSchema = z.union([z.literal(3), z.literal(4), z.literal(6)]);
export type StagingTrancheCount = z.infer<typeof StagingTrancheCountSchema>;

export const SurplusResultSchema = z
  .object({
    merchantId: MerchantIdSchema,
    modelStatus: SurplusModelStatusSchema,
    availableBalanceCents: NonNegativeMoneyCentsSchema,
    balanceSource: BalanceSourceSchema,
    monthlyObligationsCents: NonNegativeMoneyCentsSchema,
    obligationsSource: ObligationsSourceSchema,
    riskProfile: RiskProfileSchema,
    cv: z.number(),
    bufferMonths: z.number(),
    bufferTargetCents: NonNegativeMoneyCentsSchema,
    riskReserveCents: NonNegativeMoneyCentsSchema,
    safeSurplusCents: NonNegativeMoneyCentsSchema,
    stagingTrancheCount: StagingTrancheCountSchema,
    stagingScheduleCents: z.array(NonNegativeMoneyCentsSchema),
    breakdownLines: z.array(BreakdownLineSchema),
  })
  .superRefine((r, ctx) => {
    if (!(Number.isFinite(r.cv) && Number.isFinite(r.bufferMonths))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cv"],
        message: "cv and bufferMonths must be finite (no NaN/Infinity)",
      });
    }
    if (r.bufferMonths < 0 || r.bufferMonths > 9) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bufferMonths"],
        message: "bufferMonths must be within [0, 9]",
      });
    }
    if (r.stagingScheduleCents.length !== r.stagingTrancheCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stagingScheduleCents"],
        message: `stagingScheduleCents must have ${r.stagingTrancheCount} entries`,
      });
    }
    const stagingSum = r.stagingScheduleCents.reduce((a, b) => a + b, 0);
    if (stagingSum !== r.safeSurplusCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stagingScheduleCents"],
        message: `stagingScheduleCents must sum to safeSurplusCents exactly (got ${stagingSum} vs ${r.safeSurplusCents})`,
      });
    }
    if (r.breakdownLines.length !== BREAKDOWN_LINE_CODES.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["breakdownLines"],
        message: `breakdownLines must contain exactly ${BREAKDOWN_LINE_CODES.length} items`,
      });
    } else {
      for (let i = 0; i < BREAKDOWN_LINE_CODES.length; i++) {
        if (r.breakdownLines[i]?.code !== BREAKDOWN_LINE_CODES[i]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["breakdownLines"],
            message: `breakdownLines must follow the canonical order (${BREAKDOWN_LINE_CODES.join(", ")})`,
          });
          break;
        }
      }
    }
  });
export type SurplusResult = z.infer<typeof SurplusResultSchema>;

export const AllocationBandSchema = z
  .object({
    assetClass: AssetClassCodeSchema,
    label: z.string().min(1),
    minPct: z.number().int().min(0).max(100),
    maxPct: z.number().int().min(0).max(100),
    targetMidpointPct: z.number().int().min(0).max(100),
    allocatedMidpointCents: NonNegativeMoneyCentsSchema,
    reasonCode: AllocationReasonCodeSchema,
  })
  .superRefine((b, ctx) => {
    if (!(b.minPct <= b.targetMidpointPct && b.targetMidpointPct <= b.maxPct)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetMidpointPct"],
        message: "targetMidpointPct must be within [minPct, maxPct]",
      });
    }
  });
export type AllocationBand = z.infer<typeof AllocationBandSchema>;

export const StagingScheduleEntrySchema = z.object({
  trancheNumber: z.number().int().min(1),
  executeAfterDays: z.number().int().min(0),
  amountCents: NonNegativeMoneyCentsSchema,
});
export type StagingScheduleEntry = z.infer<typeof StagingScheduleEntrySchema>;

export const AllocationPlanSchema = z
  .object({
    merchantId: MerchantIdSchema,
    riskProfile: RiskProfileSchema,
    safeSurplusCents: NonNegativeMoneyCentsSchema,
    highVolatilityShiftApplied: z.boolean(),
    bands: z.array(AllocationBandSchema),
    stagingSchedule: z.array(StagingScheduleEntrySchema),
    disclaimerId: DisclaimerIdSchema,
    disclaimerText: z.string().min(1),
  })
  .superRefine((p, ctx) => {
    if (!(p.bands.length === ASSET_CLASS_CODES.length)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bands"],
        message: `bands must contain exactly ${ASSET_CLASS_CODES.length} items`,
      });
    } else {
      for (let i = 0; i < ASSET_CLASS_CODES.length; i++) {
        if (p.bands[i]?.assetClass !== ASSET_CLASS_CODES[i]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["bands"],
            message: `bands must follow the canonical order (${ASSET_CLASS_CODES.join(", ")})`,
          });
          break;
        }
      }
    }
    const targetSum = p.bands.reduce((a, b) => a + b.targetMidpointPct, 0);
    if (targetSum !== 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bands"],
        message: "targetMidpointPct values must sum to 100 exactly",
      });
    }
    const centsSum = p.bands.reduce((a, b) => a + b.allocatedMidpointCents, 0);
    if (centsSum !== p.safeSurplusCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bands"],
        message: `allocatedMidpointCents must sum to safeSurplusCents exactly (got ${centsSum} vs ${p.safeSurplusCents})`,
      });
    }
    for (let i = 0; i < p.stagingSchedule.length; i++) {
      if (p.stagingSchedule[i]?.trancheNumber !== i + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stagingSchedule"],
          message: "stagingSchedule trancheNumber values must be ascending from 1",
        });
        break;
      }
    }
  });
export type AllocationPlan = z.infer<typeof AllocationPlanSchema>;

// ---------------------------------------------------------------------------
// Advisor contracts
// ---------------------------------------------------------------------------

export const CitedMetricSchema = z.object({
  metricCode: z.string().min(1),
  rawValue: z.number(),
  formattedText: z.string().min(1),
});
export type CitedMetric = z.infer<typeof CitedMetricSchema>;

export const ToolTraceEntrySchema = z.object({
  toolName: AdvisorToolNameSchema,
  durationMs: z.number().int().nonnegative(),
  sanitizedOutputSummary: z.record(z.string(), z.union([z.number(), z.string()])),
});
export type ToolTraceEntry = z.infer<typeof ToolTraceEntrySchema>;

export const AdvisorResponseSchema = z.object({
  merchantId: MerchantIdSchema,
  narrativeMarkdown: z.string().min(1),
  citedNumbers: z.array(CitedMetricSchema),
  toolTrace: z.array(ToolTraceEntrySchema),
  validatorStatus: ValidatorStatusSchema,
  validatorMismatchesCaught: z.array(z.string()),
  disclaimerId: DisclaimerIdSchema,
  disclaimerText: z.string().min(1),
  generatedAt: IsoUtcSchema,
});
export type AdvisorResponse = z.infer<typeof AdvisorResponseSchema>;

export const IncomeShockPctSchema = z.number().int().min(-80).max(50);

export const ScenarioInputSchema = z.object({
  merchantId: MerchantIdSchema,
  monthlyObligationsCents: NonNegativeMoneyCentsSchema,
  riskProfile: RiskProfileSchema,
  incomeShockPct: IncomeShockPctSchema,
  delayedPaymentCents: NonNegativeMoneyCentsSchema,
  oneOffExpenseCents: NonNegativeMoneyCentsSchema,
});
export type ScenarioInput = z.infer<typeof ScenarioInputSchema>;

export const ScenarioComparisonResultSchema = z.object({
  scenarioInput: ScenarioInputSchema,
  baselineSurplus: SurplusResultSchema,
  stressedSurplus: SurplusResultSchema,
  stressedPlan: AllocationPlanSchema,
  deltaSafeSurplusCents: MoneyCentsSchema,
  deltaBufferMonths: z.number(),
});
export type ScenarioComparisonResult = z.infer<typeof ScenarioComparisonResultSchema>;

export const AppEventSchema = z.object({
  eventId: z.string().min(1),
  type: AppEventTypeSchema,
  at: IsoUtcSchema,
  merchantId: MerchantIdSchema,
  deltaNetCents: MoneyCentsSchema,
  updatedSummary: CashFlowSummarySchema,
  updatedSurplus: SurplusResultSchema,
  updatedPlan: AllocationPlanSchema,
});
export type AppEvent = z.infer<typeof AppEventSchema>;
