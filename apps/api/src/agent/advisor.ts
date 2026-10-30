import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  AdvisorResponse,
  AllocationPlan,
  CashFlowSummary,
  MerchantId,
  RiskProfile,
  SurplusResult,
  ToolTraceEntry,
  ValidatorStatus,
} from "@surplus/contracts";
import { AdvisorResponseSchema, DISCLAIMER_ID_V1, DISCLAIMER_TEXT_V1 } from "@surplus/contracts";
import { computeAllocationPlan, computeCashFlowSummary, computeSurplus } from "@surplus/engine";
import { generateObject } from "ai";
import { z } from "zod";
import type { MerchantDataset } from "../routes/dataset.js";
import { buildDeterministicTemplateNarrative } from "./fallbackTemplate.js";
import type { AdvisorDraft } from "./groundingValidator.js";
import { validateAdvisorOutput } from "./groundingValidator.js";

const PRIMARY_MODEL = "gemini-2.5-flash";
const FALLBACK_MODEL = "gpt-4o-mini";
const MODEL_TIMEOUT_MS = 7_000;

const AdvisorDraftSchema = z.object({
  narrativeMarkdown: z.string().min(1),
  citedNumbers: z.array(
    z.object({
      metricCode: z.string().min(1),
      rawValue: z.number(),
      formattedText: z.string().min(1),
    }),
  ),
  disclaimerId: z.literal(DISCLAIMER_ID_V1),
});

export interface RunAdvisorTurnInput {
  merchantId: MerchantId;
  dataset: MerchantDataset;
  asOf: string;
  monthlyObligationsCents?: number;
  riskProfile?: RiskProfile;
  question?: string;
}

export type AdvisorProvider = "primary" | "fallback";

export type AdvisorDraftGenerator = (input: {
  provider: AdvisorProvider;
  evidence: {
    summary: CashFlowSummary;
    surplus: SurplusResult;
    plan: AllocationPlan;
  };
  question?: string;
  rejectedTokens: string[];
}) => Promise<AdvisorDraft>;

export interface RunAdvisorTurnOptions {
  generateDraft?: AdvisorDraftGenerator;
  now?: () => Date;
}

function productionGenerator(): AdvisorDraftGenerator {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });

  return async ({ provider, evidence, question, rejectedTokens }) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
    try {
      const result = await generateObject({
        model: provider === "primary" ? google(PRIMARY_MODEL) : openai(FALLBACK_MODEL),
        schema: AdvisorDraftSchema,
        mode: "json",
        abortSignal: controller.signal,
        system: [
          "You are an educational PayPal cash-flow advisor.",
          "Use only the supplied deterministic evidence. Never calculate or invent a number.",
          "Never name a security, ticker, fund provider, cryptocurrency, or promise a return.",
          `Always return disclaimerId ${DISCLAIMER_ID_V1}.`,
          "Every cited rawValue must be copied exactly from the evidence.",
          rejectedTokens.length > 0
            ? `A prior draft was rejected. Do not emit these exact tokens: ${JSON.stringify(rejectedTokens)}.`
            : "This is the first generation attempt.",
        ].join("\n"),
        prompt: JSON.stringify({
          question: question ?? "Explain my educational surplus plan.",
          evidence,
        }),
      });
      return AdvisorDraftSchema.parse(result.object);
    } finally {
      clearTimeout(timeout);
    }
  };
}

function buildEvidence(input: RunAdvisorTurnInput): {
  summary: CashFlowSummary;
  surplus: SurplusResult;
  plan: AllocationPlan;
  toolTrace: ToolTraceEntry[];
} {
  const context = {
    merchantId: input.merchantId,
    transactions: input.dataset.transactions,
    asOf: input.asOf,
    availableBalanceCents: input.dataset.availableBalanceCents,
    balanceSource: input.dataset.balanceSource,
    monthlyObligationsCents: input.monthlyObligationsCents,
    riskProfile: input.riskProfile ?? ("BALANCED" as const),
    openDisputes: input.dataset.openDisputes,
    excludedNonUsdCount: input.dataset.excludedNonUsdCount,
  };
  const summary = computeCashFlowSummary(context);
  const surplus = computeSurplus(context);
  const plan = computeAllocationPlan(surplus);
  return {
    summary,
    surplus,
    plan,
    toolTrace: [
      {
        toolName: "get_cash_flow_summary",
        durationMs: 0,
        sanitizedOutputSummary: {
          completedMonthsCount: summary.completedMonthsCount,
          baselineMonthlyNetCents: summary.baselineMonthlyNetCents,
        },
      },
      {
        toolName: "get_surplus",
        durationMs: 0,
        sanitizedOutputSummary: {
          modelStatus: surplus.modelStatus,
          safeSurplusCents: surplus.safeSurplusCents,
        },
      },
      {
        toolName: "get_allocation_plan",
        durationMs: 0,
        sanitizedOutputSummary: {
          bandCount: plan.bands.length,
          stagingTrancheCount: plan.stagingSchedule.length,
        },
      },
    ],
  };
}

async function generateWithProviderFallback(
  generator: AdvisorDraftGenerator,
  request: Omit<Parameters<AdvisorDraftGenerator>[0], "provider">,
  failures: string[],
): Promise<AdvisorDraft | undefined> {
  try {
    return await generator({ ...request, provider: "primary" });
  } catch {
    failures.push("model:primary_failed");
  }
  try {
    return await generator({ ...request, provider: "fallback" });
  } catch {
    failures.push("model:fallback_failed");
    return undefined;
  }
}

function response(
  input: RunAdvisorTurnInput,
  draft: AdvisorDraft,
  toolTrace: ToolTraceEntry[],
  validatorStatus: ValidatorStatus,
  mismatches: string[],
  now: () => Date,
): AdvisorResponse {
  return AdvisorResponseSchema.parse({
    merchantId: input.merchantId,
    ...draft,
    toolTrace,
    validatorStatus,
    validatorMismatchesCaught: mismatches,
    disclaimerText: DISCLAIMER_TEXT_V1,
    generatedAt: now().toISOString(),
  });
}

/** C-2 orchestration: deterministic evidence, provider fallback, validation, one repair, template. */
export async function runAdvisorTurn(
  input: RunAdvisorTurnInput,
  options: RunAdvisorTurnOptions = {},
): Promise<AdvisorResponse> {
  const { summary, surplus, plan, toolTrace } = buildEvidence(input);
  const evidence = { summary, surplus, plan };
  const outputs = [summary, surplus, plan];
  const generator = options.generateDraft ?? productionGenerator();
  const mismatches: string[] = [];

  const first = await generateWithProviderFallback(
    generator,
    { evidence, question: input.question, rejectedTokens: [] },
    mismatches,
  );
  if (first) {
    const validation = validateAdvisorOutput(first, outputs);
    if (validation.valid) {
      return response(
        input,
        first,
        toolTrace,
        "PASSED",
        mismatches,
        options.now ?? (() => new Date()),
      );
    }
    mismatches.push(...validation.mismatches);
    const regenerated = await generateWithProviderFallback(
      generator,
      { evidence, question: input.question, rejectedTokens: validation.mismatches },
      mismatches,
    );
    if (regenerated) {
      const regeneratedValidation = validateAdvisorOutput(regenerated, outputs);
      if (regeneratedValidation.valid) {
        return response(
          input,
          regenerated,
          toolTrace,
          "REGENERATED_PASSED",
          mismatches,
          options.now ?? (() => new Date()),
        );
      }
      mismatches.push(...regeneratedValidation.mismatches);
    }
  }

  const fallback = buildDeterministicTemplateNarrative(summary, surplus, plan);
  return response(
    input,
    fallback,
    toolTrace,
    "FALLBACK_TEMPLATE",
    mismatches,
    options.now ?? (() => new Date()),
  );
}
