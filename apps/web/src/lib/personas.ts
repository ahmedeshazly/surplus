// Owner: R5. Persona and risk-profile presentation metadata. Merchant ids come
// from the frozen @surplus/contracts enum; no contract types are redefined.
import type { MerchantId, RiskProfile } from "@surplus/contracts";

export interface PersonaOption {
  id: MerchantId;
  label: string;
  shortLabel: string;
  description: string;
  dataSource: "live" | "fixture";
  defaultObligationsCents: number;
}

export const PERSONAS = [
  {
    id: "live_sandbox",
    label: "Demo Live Sandbox Merchant",
    shortLabel: "Live Sandbox",
    description: "Starts empty and grows only from verified PayPal Sandbox webhooks.",
    dataSource: "live",
    defaultObligationsCents: 300_000,
  },
  {
    id: "persona_steady_retainer",
    label: "Steady Retainer",
    shortLabel: "Steady",
    description: "Predictable monthly retainers with low income volatility.",
    dataSource: "fixture",
    defaultObligationsCents: 300_000,
  },
  {
    id: "persona_volatile_freelancer",
    label: "Volatile Freelancer",
    shortLabel: "Volatile",
    description: "Lumpy project income that needs a wider cash buffer.",
    dataSource: "fixture",
    defaultObligationsCents: 300_000,
  },
  {
    id: "persona_seasonal_seller",
    label: "Seasonal Seller",
    shortLabel: "Seasonal",
    description: "Strong peak-season revenue with quieter shoulder months.",
    dataSource: "fixture",
    defaultObligationsCents: 300_000,
  },
  {
    id: "persona_dispute_spike",
    label: "Dispute Spike",
    shortLabel: "Disputes",
    description: "Elevated refunds and open disputes pressure the safe surplus.",
    dataSource: "fixture",
    defaultObligationsCents: 300_000,
  },
] as const satisfies readonly PersonaOption[];

export const DEFAULT_PERSONA_ID: MerchantId = PERSONAS[0].id;

export function personaById(id: MerchantId): PersonaOption {
  return PERSONAS.find((persona) => persona.id === id) ?? PERSONAS[0];
}

export interface RiskProfileOption {
  id: RiskProfile;
  label: string;
  description: string;
}

export const RISK_PROFILES = [
  {
    id: "CONSERVATIVE",
    label: "Conservative",
    description: "6 staged tranches · wider cash and bond bands",
  },
  {
    id: "BALANCED",
    label: "Balanced",
    description: "4 staged tranches · balanced asset-class bands",
  },
  {
    id: "GROWTH",
    label: "Growth",
    description: "3 staged tranches · larger equity index band",
  },
] as const satisfies readonly RiskProfileOption[];

export function riskProfileLabel(profile: RiskProfile): string {
  return RISK_PROFILES.find((option) => option.id === profile)?.label ?? profile;
}
