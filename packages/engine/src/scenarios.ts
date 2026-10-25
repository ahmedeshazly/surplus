// Owner: R3 (exclusively). Task F-8. Deterministic what-if scenario engine.
// Locked semantics (docs/decisions.md):
// - The income shock scales ONLY kind=income, status=COMPLETED rows (gross and fee are each
//   rounded per row via Math.round(k x value)); refunds, chargebacks, withdrawals and the
//   dispute set are unchanged.
// - The stressed available balance is max(0, available - delayedPayment - oneOffExpense).
// - The stressed case recomputes the full engine chain (CV, buffer, refund rate, reserve).
// - The baseline is computed with the scenario's obligations/profile; base merchantId and
//   riskProfile must match the scenario, and base obligations (when supplied) must equal the
//   scenario's.
import type { ScenarioComparisonResult, ScenarioInput } from "@surplus/contracts";
import { ScenarioComparisonResultSchema, ScenarioInputSchema } from "@surplus/contracts";
import { round2 } from "./rounding";
import { computeAllocationPlan } from "./allocation";
import { computeSurplus } from "./surplus";
import type { ComputeSurplusInput } from "./surplus";
import { requireIsoUtc, requireTransactions } from "./validate";

export function runScenarioComparison(
  base: ComputeSurplusInput,
  scenario: ScenarioInput,
): ScenarioComparisonResult {
  const scenarioInput = ScenarioInputSchema.parse(scenario);
  requireTransactions(base.transactions);
  requireIsoUtc(base.asOf);

  if (scenarioInput.merchantId !== base.merchantId) {
    throw new Error(
      `scenario merchantId '${scenarioInput.merchantId}' does not match base merchantId '${base.merchantId}'`,
    );
  }
  if (scenarioInput.riskProfile !== base.riskProfile) {
    throw new Error(
      `scenario riskProfile '${scenarioInput.riskProfile}' does not match base riskProfile '${base.riskProfile}'`,
    );
  }
  if (
    base.monthlyObligationsCents !== undefined &&
    base.monthlyObligationsCents !== scenarioInput.monthlyObligationsCents
  ) {
    throw new Error(
      `scenario monthlyObligationsCents (${scenarioInput.monthlyObligationsCents}) does not match base obligations (${base.monthlyObligationsCents})`,
    );
  }

  const k = 1 + scenarioInput.incomeShockPct / 100;
  const stressedTransactions = base.transactions.map((row) => {
    if (row.kind !== "income" || row.status !== "COMPLETED") return row;
    const grossCents = Math.round(k * row.grossCents);
    const feeCents = Math.round(k * row.feeCents);
    return { ...row, grossCents, feeCents, netCents: grossCents - feeCents };
  });

  const stressedAvailableBalanceCents = Math.max(
    0,
    base.availableBalanceCents -
      scenarioInput.delayedPaymentCents -
      scenarioInput.oneOffExpenseCents,
  );

  const baselineSurplus = computeSurplus({
    ...base,
    monthlyObligationsCents: scenarioInput.monthlyObligationsCents,
  });
  const stressedSurplus = computeSurplus({
    ...base,
    transactions: stressedTransactions,
    availableBalanceCents: stressedAvailableBalanceCents,
    monthlyObligationsCents: scenarioInput.monthlyObligationsCents,
  });
  const stressedPlan = computeAllocationPlan(stressedSurplus);

  const result: ScenarioComparisonResult = {
    scenarioInput,
    baselineSurplus,
    stressedSurplus,
    stressedPlan,
    deltaSafeSurplusCents: stressedSurplus.safeSurplusCents - baselineSurplus.safeSurplusCents,
    deltaBufferMonths: round2(stressedSurplus.bufferMonths - baselineSurplus.bufferMonths),
  };
  return ScenarioComparisonResultSchema.parse(result);
}
