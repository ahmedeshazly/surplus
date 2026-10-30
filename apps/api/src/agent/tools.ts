import type { ScenarioInput } from "@surplus/contracts";
import {
  computeAllocationPlan,
  computeCashFlowSummary,
  computeSurplus,
  runScenarioComparison,
} from "@surplus/engine";
import type { ComputeSurplusInput } from "@surplus/engine";
import { tool } from "ai";
import { z } from "zod";
import type { wrapReadOnlyMcpTools } from "./mcpClient.js";

export type AdvisorEngineContext = ComputeSurplusInput;
export type SafePaypalMcpTools = ReturnType<typeof wrapReadOnlyMcpTools>;

const scenarioParameters = z.object({
  incomeShockPct: z.number().min(-80).max(50),
  delayedPaymentCents: z.number().int().nonnegative(),
  oneOffExpenseCents: z.number().int().nonnegative(),
});

const SAFE_PAYPAL_TOOL_NAMES = [
  "paypal_mcp_list_transactions",
  "paypal_mcp_list_disputes",
  "paypal_mcp_get_merchant_insights",
] as const;

/** Engine-backed tools are deterministic. The model receives their outputs; it never performs the math. */
export function createInternalAdvisorTools(context: AdvisorEngineContext) {
  return {
    get_cash_flow_summary: tool({
      description: "Return the deterministic cash-flow summary for the current merchant context.",
      parameters: z.object({}),
      execute: async () =>
        computeCashFlowSummary({
          merchantId: context.merchantId,
          transactions: context.transactions,
          asOf: context.asOf,
          openDisputes: context.openDisputes,
          excludedNonUsdCount: context.excludedNonUsdCount,
        }),
    }),
    get_surplus: tool({
      description: "Return the deterministic surplus calculation for the current merchant context.",
      parameters: z.object({}),
      execute: async () => computeSurplus(context),
    }),
    get_allocation_plan: tool({
      description:
        "Return the deterministic educational allocation plan for the current merchant context.",
      parameters: z.object({}),
      execute: async () => computeAllocationPlan(computeSurplus(context)),
    }),
    run_scenario: tool({
      description:
        "Run the deterministic scenario engine. Money inputs are integer cents and incomeShockPct is between -80 and 50.",
      parameters: scenarioParameters,
      execute: async (input) => {
        const surplus = computeSurplus(context);
        const scenario: ScenarioInput = {
          merchantId: context.merchantId,
          riskProfile: context.riskProfile,
          monthlyObligationsCents: surplus.monthlyObligationsCents,
          ...input,
        };
        return runScenarioComparison(context, scenario);
      },
    }),
  };
}

/**
 * Build the complete F-11 registry. Filter MCP tools again so an injected or
 * accidentally discovered write tool cannot enter the advisor through composition.
 */
export function createAdvisorTools(
  context: AdvisorEngineContext,
  paypalMcpTools: SafePaypalMcpTools = {},
) {
  const safePaypalTools: SafePaypalMcpTools = {};
  for (const name of SAFE_PAYPAL_TOOL_NAMES) {
    const paypalTool = paypalMcpTools[name];
    if (paypalTool) safePaypalTools[name] = paypalTool;
  }
  const internalTools = createInternalAdvisorTools(context);
  return {
    ...internalTools,
    ...safePaypalTools,
  } as typeof internalTools & SafePaypalMcpTools;
}
