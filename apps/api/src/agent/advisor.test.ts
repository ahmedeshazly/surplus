import { AdvisorResponseSchema, DISCLAIMER_ID_V1 } from "@surplus/contracts";
import {
  DEMO_AS_OF,
  exampleNormalizedTransaction,
  exampleOpenDisputesSummary,
  exampleSurplusResult,
} from "@surplus/contracts/examples";
import { describe, expect, it, vi } from "vitest";
import { ADVISOR_ENV_KEYS, runAdvisorTurn } from "./advisor.js";
import type { AdvisorDraftGenerator, RunAdvisorTurnInput } from "./advisor.js";
import { buildDeterministicTemplateNarrative } from "./fallbackTemplate.js";

const input: RunAdvisorTurnInput = {
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

const now = () => new Date("2026-10-30T12:00:00.000Z");

function groundedGenerator(): AdvisorDraftGenerator {
  return async ({ evidence }) =>
    buildDeterministicTemplateNarrative(evidence.summary, evidence.surplus, evidence.plan);
}

describe("runAdvisorTurn", () => {
  it("uses the environment variable names standardized by the deployment config", () => {
    expect(ADVISOR_ENV_KEYS).toEqual({
      google: "GOOGLE_GENERATIVE_AI_API_KEY",
      openai: "OPENAI_API_KEY",
    });
  });

  it("returns a schema-valid response after first-pass grounding", async () => {
    const result = await runAdvisorTurn(input, { generateDraft: groundedGenerator(), now });
    expect(AdvisorResponseSchema.parse(result)).toEqual(result);
    expect(result.validatorStatus).toBe("PASSED");
    expect(result.disclaimerId).toBe(DISCLAIMER_ID_V1);
    expect(result.toolTrace.map((entry) => entry.toolName)).toEqual([
      "get_cash_flow_summary",
      "get_surplus",
      "get_allocation_plan",
    ]);
  });

  it("regenerates once with the exact rejected tokens", async () => {
    const calls: Parameters<AdvisorDraftGenerator>[0][] = [];
    const generator: AdvisorDraftGenerator = async (request) => {
      calls.push(request);
      if (calls.length === 1) {
        return {
          narrativeMarkdown: "Put $99,999 into AAPL; returns are guaranteed.",
          citedNumbers: [],
          disclaimerId: DISCLAIMER_ID_V1,
        };
      }
      return buildDeterministicTemplateNarrative(
        request.evidence.summary,
        request.evidence.surplus,
        request.evidence.plan,
      );
    };

    const result = await runAdvisorTurn(input, { generateDraft: generator, now });
    expect(result.validatorStatus).toBe("REGENERATED_PASSED");
    expect(result.validatorMismatchesCaught).toEqual(
      expect.arrayContaining(["$99,999", "AAPL", "guaranteed"]),
    );
    expect(calls[1]?.rejectedTokens).toEqual(
      expect.arrayContaining(["$99,999", "AAPL", "guaranteed"]),
    );
  });

  it("uses OpenAI fallback when the primary provider fails", async () => {
    const generator = vi.fn<AdvisorDraftGenerator>(async (request) => {
      if (request.provider === "primary") throw new Error("simulated model failure");
      return buildDeterministicTemplateNarrative(
        request.evidence.summary,
        request.evidence.surplus,
        request.evidence.plan,
      );
    });

    const result = await runAdvisorTurn(input, { generateDraft: generator, now });
    expect(result.validatorStatus).toBe("PASSED");
    expect(result.validatorMismatchesCaught).toContain("model:primary_failed");
    expect(generator.mock.calls.map(([request]) => request.provider)).toEqual([
      "primary",
      "fallback",
    ]);
  });

  it("falls back deterministically when both providers fail", async () => {
    const generator: AdvisorDraftGenerator = async () => {
      throw new Error("simulated model failure");
    };
    const result = await runAdvisorTurn(input, { generateDraft: generator, now });
    expect(result.validatorStatus).toBe("FALLBACK_TEMPLATE");
    expect(result.validatorMismatchesCaught).toEqual([
      "model:primary_failed",
      "model:fallback_failed",
    ]);
    expect(result.narrativeMarkdown).toContain("Educational surplus view");
  });

  it("falls back after one regeneration still contains a banned ticker", async () => {
    const generator: AdvisorDraftGenerator = async () => ({
      narrativeMarkdown: "AAPL",
      citedNumbers: [],
      disclaimerId: DISCLAIMER_ID_V1,
    });
    const result = await runAdvisorTurn(input, { generateDraft: generator, now });
    expect(result.validatorStatus).toBe("FALLBACK_TEMPLATE");
    expect(result.validatorMismatchesCaught).toContain("AAPL");
  });
});
