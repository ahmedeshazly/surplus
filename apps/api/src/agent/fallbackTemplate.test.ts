import { AdvisorResponseSchema, DISCLAIMER_TEXT_V1 } from "@surplus/contracts";
import {
  DEMO_AS_OF,
  exampleAllocationPlan,
  exampleCashFlowSummary,
  exampleSurplusResult,
} from "@surplus/contracts/examples";
import { describe, expect, it } from "vitest";
import { buildDeterministicTemplateNarrative } from "./fallbackTemplate.js";
import { validateAdvisorOutput } from "./groundingValidator.js";

describe("buildDeterministicTemplateNarrative", () => {
  it("builds a contract-valid narrative that passes the same grounding gate", () => {
    const draft = buildDeterministicTemplateNarrative(
      exampleCashFlowSummary,
      exampleSurplusResult,
      exampleAllocationPlan,
    );
    const outputs = [exampleCashFlowSummary, exampleSurplusResult, exampleAllocationPlan];

    expect(validateAdvisorOutput(draft, outputs)).toEqual({ valid: true, mismatches: [] });
    expect(
      AdvisorResponseSchema.safeParse({
        merchantId: exampleSurplusResult.merchantId,
        ...draft,
        toolTrace: [],
        validatorStatus: "FALLBACK_TEMPLATE",
        validatorMismatchesCaught: [],
        disclaimerText: DISCLAIMER_TEXT_V1,
        generatedAt: DEMO_AS_OF,
      }).success,
    ).toBe(true);
  });
});
