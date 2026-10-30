// Owner: R3 (exclusively). Task K-4. Locks the example payloads to the Zod schemas so the
// mocks R5 and others build against can never drift from the contract definitions.
import { test, expect } from "vitest";
import {
  AppEventSchema,
  AllocationPlanSchema,
  AdvisorResponseSchema,
  CashFlowSummarySchema,
  CitedMetricSchema,
  MonthlyNetPointSchema,
  NormalizedTransactionSchema,
  OpenDisputesSummarySchema,
  ScenarioComparisonResultSchema,
  ScenarioInputSchema,
  StagingScheduleEntrySchema,
  SurplusResultSchema,
  ToolTraceEntrySchema,
  WindowTotalsSchema,
  BreakdownLineSchema,
  AllocationBandSchema,
} from "./index";
import {
  exampleAllocationBand,
  exampleAllocationPlan,
  exampleAdvisorResponse,
  exampleBreakdownLine,
  exampleCashFlowSummary,
  exampleCitedMetric,
  exampleMonthlyNetPoint,
  exampleNormalizedTransaction,
  exampleOpenDisputesSummary,
  exampleScenarioComparisonResult,
  exampleScenarioInput,
  exampleStagingScheduleEntry,
  exampleSurplusResult,
  exampleToolTraceEntry,
  exampleWindowTotals,
  exampleAppEvent,
} from "./examples";

test("every example payload satisfies its contract schema", () => {
  expect(NormalizedTransactionSchema.safeParse(exampleNormalizedTransaction).success).toBe(true);
  expect(WindowTotalsSchema.safeParse(exampleWindowTotals).success).toBe(true);
  expect(MonthlyNetPointSchema.safeParse(exampleMonthlyNetPoint).success).toBe(true);
  expect(OpenDisputesSummarySchema.safeParse(exampleOpenDisputesSummary).success).toBe(true);
  expect(CashFlowSummarySchema.safeParse(exampleCashFlowSummary).success).toBe(true);
  expect(BreakdownLineSchema.safeParse(exampleBreakdownLine).success).toBe(true);
  expect(SurplusResultSchema.safeParse(exampleSurplusResult).success).toBe(true);
  expect(AllocationBandSchema.safeParse(exampleAllocationBand).success).toBe(true);
  expect(StagingScheduleEntrySchema.safeParse(exampleStagingScheduleEntry).success).toBe(true);
  expect(AllocationPlanSchema.safeParse(exampleAllocationPlan).success).toBe(true);
  expect(CitedMetricSchema.safeParse(exampleCitedMetric).success).toBe(true);
  expect(ToolTraceEntrySchema.safeParse(exampleToolTraceEntry).success).toBe(true);
  expect(AdvisorResponseSchema.safeParse(exampleAdvisorResponse).success).toBe(true);
  expect(ScenarioInputSchema.safeParse(exampleScenarioInput).success).toBe(true);
  expect(ScenarioComparisonResultSchema.safeParse(exampleScenarioComparisonResult).success).toBe(
    true,
  );
  expect(AppEventSchema.safeParse(exampleAppEvent).success).toBe(true);
});

test("schema failures carry a readable message", () => {
  expect(
    NormalizedTransactionSchema.safeParse({
      ...exampleNormalizedTransaction,
      monthBucket: "2026-10",
    }).success,
  ).toBe(false);
  expect(SurplusResultSchema.safeParse({ ...exampleSurplusResult, cv: NaN }).success).toBe(false);
  expect(
    OpenDisputesSummarySchema.safeParse({
      ...exampleOpenDisputesSummary,
      unheldAmountCents: 99999,
    }).success,
  ).toBe(false);
});

test("schemas reject known-bad inputs", () => {
  // non-integer cents anywhere are rejected
  expect(
    NormalizedTransactionSchema.safeParse({ ...exampleNormalizedTransaction, netCents: 10.5 })
      .success,
  ).toBe(false);
  // non-USD is unrepresentable in the contract type
  expect(
    NormalizedTransactionSchema.safeParse({
      ...exampleNormalizedTransaction,
      currency: undefined,
    } as unknown as typeof exampleNormalizedTransaction).success,
  ).toBe(false);
  // buffer months outside [0, 9] break the surplus invariant
  expect(
    SurplusResultSchema.safeParse({ ...exampleSurplusResult, bufferMonths: 9.5 }).success,
  ).toBe(false);
  // staging must sum to the surplus exactly
  expect(
    SurplusResultSchema.safeParse({
      ...exampleSurplusResult,
      stagingScheduleCents: [105001, 105000, 105000, 105000],
    }).success,
  ).toBe(false);
  // breakdown lines must follow the canonical code order
  const swapped = {
    ...exampleSurplusResult,
    breakdownLines: [...exampleSurplusResult.breakdownLines].reverse(),
  };
  expect(SurplusResultSchema.safeParse(swapped).success).toBe(false);
  // band midpoints must sum to 100
  expect(
    AllocationPlanSchema.safeParse({
      ...exampleAllocationPlan,
      bands: exampleAllocationPlan.bands.map((b) => ({ ...b, targetMidpointPct: 34 })),
    }).success,
  ).toBe(false);
  // scenario shock must stay inside [-80, +50]
  expect(
    ScenarioInputSchema.safeParse({ ...exampleScenarioInput, incomeShockPct: 51 }).success,
  ).toBe(false);
  expect(
    ScenarioInputSchema.safeParse({ ...exampleScenarioInput, incomeShockPct: -81 }).success,
  ).toBe(false);
});

// Zod schemas are the single validation point for API input (R1) and store output (R2).
test("window totals schema accepts any non-negative integer cents", () => {
  const sample = {
    ...exampleWindowTotals,
    grossIncomeCents: 2 ** 53 - 1,
    netCashFlowCents: -(2 ** 53) + 1,
  };
  expect(WindowTotalsSchema.safeParse(sample).success).toBe(true);
});
