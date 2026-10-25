// Owner: R1. Task F-9: request-validation schemas for the API routes.
//
// These are thin wrapper schemas only. Every field type and enum is imported
// from @surplus/contracts; nothing is redefined here. R3 may absorb these into
// packages/contracts in a later pass (recorded as a request in docs/decisions.md).
import { z } from "zod";
import {
  IncomeShockPctSchema,
  MerchantIdSchema,
  RiskProfileSchema,
} from "@surplus/contracts";

const NonNegativeIntSchema = z.number().int().min(0);

/** GET /api/summary, GET /api/transactions, GET /api/events query string. */
export const MerchantQuerySchema = z.object({
  merchantId: MerchantIdSchema,
});

/** GET /api/surplus query string. Defaults match the dashboard's first paint. */
export const SurplusQuerySchema = z.object({
  merchantId: MerchantIdSchema,
  riskProfile: RiskProfileSchema.default("BALANCED"),
  monthlyObligationsCents: z.coerce.number().int().min(0).optional(),
});

/** POST /api/plan and POST /api/advisor body. */
export const PlanRequestSchema = z.object({
  merchantId: MerchantIdSchema,
  monthlyObligationsCents: NonNegativeIntSchema.optional(),
  riskProfile: RiskProfileSchema,
});

/** POST /api/scenario body. monthlyObligationsCents is required by ScenarioInput. */
export const ScenarioRequestSchema = z.object({
  merchantId: MerchantIdSchema,
  monthlyObligationsCents: NonNegativeIntSchema,
  riskProfile: RiskProfileSchema,
  incomeShockPct: IncomeShockPctSchema,
  delayedPaymentCents: NonNegativeIntSchema,
  oneOffExpenseCents: NonNegativeIntSchema,
});

export type PlanRequest = z.infer<typeof PlanRequestSchema>;
export type ScenarioRequest = z.infer<typeof ScenarioRequestSchema>;
