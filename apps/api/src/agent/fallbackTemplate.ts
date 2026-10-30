import type { AllocationPlan, CashFlowSummary, CitedMetric, SurplusResult } from "@surplus/contracts";
import { DISCLAIMER_ID_V1 } from "@surplus/contracts";
import type { AdvisorDraft } from "./groundingValidator.js";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(cents: number): string {
  return usd.format(cents / 100);
}

function cited(metricCode: string, rawValue: number, formattedText: string): CitedMetric {
  return { metricCode, rawValue, formattedText };
}

/** Deterministic, grounded response used whenever model output cannot safely pass validation. */
export function buildDeterministicTemplateNarrative(
  summary: CashFlowSummary,
  surplus: SurplusResult,
  plan: AllocationPlan,
): AdvisorDraft {
  const safeSurplus = money(surplus.safeSurplusCents);
  const bufferTarget = money(surplus.bufferTargetCents);
  const monthlyNet = money(summary.baselineMonthlyNetCents);
  const allocationLines = plan.bands.map(
    (band) =>
      `- ${band.label}: ${band.targetMidpointPct}% (${money(band.allocatedMidpointCents)})`,
  );
  const stagingLines = plan.stagingSchedule.map(
    (entry) =>
      `- Tranche ${entry.trancheNumber}, after ${entry.executeAfterDays} days: ${money(entry.amountCents)}`,
  );

  return {
    narrativeMarkdown: [
      "## Cash-flow snapshot",
      `Your completed-month baseline net cash flow is ${monthlyNet}.`,
      "",
      "## Educational surplus view",
      `The deterministic engine identifies ${safeSurplus} as safe surplus after a ${bufferTarget} buffer target and risk reserve.`,
      "",
      "## Allocation bands",
      ...allocationLines,
      "",
      "## Staging schedule",
      ...stagingLines,
      "",
      "Review these educational bands against your own circumstances before making a decision.",
    ].join("\n"),
    citedNumbers: [
      cited("baseline_monthly_net_cents", summary.baselineMonthlyNetCents, monthlyNet),
      cited("safe_surplus_cents", surplus.safeSurplusCents, safeSurplus),
      cited("buffer_target_cents", surplus.bufferTargetCents, bufferTarget),
      ...plan.bands.flatMap((band) => [
        cited(
          `${band.assetClass.toLowerCase()}_target_pct`,
          band.targetMidpointPct,
          `${band.targetMidpointPct}%`,
        ),
        cited(
          `${band.assetClass.toLowerCase()}_allocated_cents`,
          band.allocatedMidpointCents,
          money(band.allocatedMidpointCents),
        ),
      ]),
      ...plan.stagingSchedule.map((entry) =>
        cited(`staging_tranche_${entry.trancheNumber}_cents`, entry.amountCents, money(entry.amountCents)),
      ),
    ],
    disclaimerId: DISCLAIMER_ID_V1,
  };
}
