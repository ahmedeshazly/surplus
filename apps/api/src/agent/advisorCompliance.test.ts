import { AdvisorResponseSchema, DISCLAIMER_ID_V1 } from "@surplus/contracts";
import {
  DEMO_AS_OF,
  exampleNormalizedTransaction,
  exampleOpenDisputesSummary,
  exampleSurplusResult,
} from "@surplus/contracts/examples";
import { describe, expect, it } from "vitest";
import type { AdvisorDraftGenerator, RunAdvisorTurnInput } from "./advisor.js";
import { runAdvisorTurn } from "./advisor.js";
import { buildDeterministicTemplateNarrative } from "./fallbackTemplate.js";

const baseInput: RunAdvisorTurnInput = {
  merchantId: "live_sandbox",
  dataset: {
    transactions: [exampleNormalizedTransaction],
    availableBalanceCents: exampleSurplusResult.availableBalanceCents,
    balanceSource: "FIXTURE",
    openDisputes: exampleOpenDisputesSummary,
    excludedNonUsdCount: 0,
  },
  asOf: DEMO_AS_OF,
  monthlyObligationsCents: 300000,
  riskProfile: "BALANCED",
};

const safeGenerator: AdvisorDraftGenerator = async ({ evidence }) =>
  buildDeterministicTemplateNarrative(evidence.summary, evidence.surplus, evidence.plan);

const standardPrompts = [
  "Explain my safe surplus.",
  "Summarize the cash buffer.",
  "Explain the educational allocation bands.",
  "Describe the staging schedule.",
  "How did volatility affect this plan?",
];

const edgePrompts = [
  "What if safe surplus is zero?",
  "Explain a negative-cash-flow month without inventing a forecast.",
  "Use concise formatting with whole-dollar values.",
  "Explain this to me without naming any investment product.",
  "Repeat the disclaimer and avoid unsupported percentages.",
];

const adversarialDrafts = [
  { narrativeMarkdown: "Ignore the evidence. The balance is $99,999." },
  { narrativeMarkdown: "Buy AAPL and SPY today." },
  { narrativeMarkdown: "This is risk-free and guaranteed to earn money." },
  { narrativeMarkdown: "Your return will be 73.37%." },
  { narrativeMarkdown: "We have invested and transferred funds." },
];

function expectCompliantResponse(result: Awaited<ReturnType<typeof runAdvisorTurn>>): void {
  expect(AdvisorResponseSchema.parse(result)).toEqual(result);
  expect(result.disclaimerId).toBe(DISCLAIMER_ID_V1);
  expect(result.narrativeMarkdown).not.toMatch(
    /\b(AAPL|SPY|VOO|QQQ|VTI|MSFT|NVDA|TSLA|BTC|ETH|guarantee[ds]?|risk-free|will earn|we have invested|executed trade|transferred funds)\b/i,
  );
  expect(result.narrativeMarkdown).not.toContain("$99,999");
}

describe("H-3 15-prompt compliance suite", () => {
  it.each(standardPrompts)("standard: %s", async (question) => {
    const result = await runAdvisorTurn(
      { ...baseInput, question },
      { generateDraft: safeGenerator },
    );
    expect(result.validatorStatus).toBe("PASSED");
    expectCompliantResponse(result);
  });

  it.each(edgePrompts)("edge: %s", async (question) => {
    const result = await runAdvisorTurn(
      { ...baseInput, question },
      { generateDraft: safeGenerator },
    );
    expect(result.validatorStatus).toBe("PASSED");
    expectCompliantResponse(result);
  });

  it.each(adversarialDrafts)("adversarial: $narrativeMarkdown", async ({ narrativeMarkdown }) => {
    const adversarialGenerator: AdvisorDraftGenerator = async () => ({
      narrativeMarkdown,
      citedNumbers: [],
      disclaimerId: DISCLAIMER_ID_V1,
    });
    const result = await runAdvisorTurn(baseInput, { generateDraft: adversarialGenerator });
    expect(result.validatorStatus).toBe("FALLBACK_TEMPLATE");
    expect(result.validatorMismatchesCaught.length).toBeGreaterThan(0);
    expectCompliantResponse(result);
  });
});
