import type { CitedMetric, DisclaimerId } from "@surplus/contracts";
import { DISCLAIMER_ID_V1 } from "@surplus/contracts";

export interface AdvisorDraft {
  narrativeMarkdown: string;
  citedNumbers: CitedMetric[];
  disclaimerId: DisclaimerId;
}

export interface GroundingValidationResult {
  valid: boolean;
  mismatches: string[];
}

const BANNED_INSTRUMENTS =
  /\b(S&P\s*500|SPY|VOO|QQQ|VTI|AAPL|MSFT|NVDA|TSLA|BTC|ETH|Bitcoin|Ethereum|Vanguard|BlackRock|Fidelity)\b/gi;
const BANNED_PROMISES =
  /\b(guarantee[ds]?|risk-free|will earn|we have invested|executed trade|transferred funds)\b/gi;
const CURRENCY_TOKEN = /-?\$\s?\d[\d,]*(?:\.\d+)?/g;
const PERCENT_TOKEN = /-?\d+(?:\.\d+)?%(?!\d)/g;
const STRUCTURAL_CONSTANTS = [3, 4, 6, 9, 10, 12, 31, 90, 100, 2025, 2026] as const;

interface EvidenceRegistry {
  raw: number[];
  currency: number[];
  percentages: number[];
}

function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(0.01, Math.abs(expected) * 0.001);
}

function collectEvidence(value: unknown, registry: EvidenceRegistry, key = ""): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    registry.raw.push(value);
    if (/Cents$/i.test(key)) registry.currency.push(value / 100);
    if (/Pct$/i.test(key)) registry.percentages.push(value);
    if (/^(cv|rate|ratio)/i.test(key)) registry.percentages.push(value * 100);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectEvidence(entry, registry, key);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [childKey, child] of Object.entries(value)) {
      collectEvidence(child, registry, childKey);
    }
  }
}

function parsedNumber(token: string): number {
  return Number(token.replace(/[$,%\s]/g, ""));
}

function validCurrencyShape(token: string): boolean {
  const numeric = token.replace(/[-$\s]/g, "");
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(numeric);
}

function citationMatches(citation: CitedMetric, candidate: number): boolean {
  const difference = Math.abs(citation.rawValue - candidate);
  if (/_cents$/i.test(citation.metricCode)) return difference <= 1;
  return difference <= Math.max(0.001, Math.abs(candidate) * 0.001);
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0;
  return [...new Set(text.match(pattern) ?? [])];
}

/** Validate every financial claim against deterministic tool output before it reaches a user. */
export function validateAdvisorOutput(
  draft: AdvisorDraft,
  toolOutputs: readonly unknown[],
): GroundingValidationResult {
  const mismatches = new Set<string>();
  const registry: EvidenceRegistry = { raw: [], currency: [], percentages: [] };
  for (const output of toolOutputs) collectEvidence(output, registry);
  registry.raw.push(...STRUCTURAL_CONSTANTS);

  if (draft.disclaimerId !== DISCLAIMER_ID_V1) {
    mismatches.add(`disclaimer:${draft.disclaimerId}`);
  }

  const text = [
    draft.narrativeMarkdown,
    ...draft.citedNumbers.map((citation) => citation.formattedText),
  ].join("\n");

  for (const token of uniqueMatches(text, BANNED_INSTRUMENTS)) mismatches.add(token);
  for (const token of uniqueMatches(text, BANNED_PROMISES)) mismatches.add(token);

  for (const token of uniqueMatches(text, CURRENCY_TOKEN)) {
    const value = parsedNumber(token);
    if (
      !validCurrencyShape(token) ||
      !registry.currency.some((candidate) => closeEnough(value, candidate))
    ) {
      mismatches.add(token);
    }
  }
  for (const token of uniqueMatches(text, PERCENT_TOKEN)) {
    const value = parsedNumber(token);
    if (!registry.percentages.some((candidate) => closeEnough(value, candidate))) {
      mismatches.add(token);
    }
  }
  for (const citation of draft.citedNumbers) {
    if (!registry.raw.some((candidate) => citationMatches(citation, candidate))) {
      mismatches.add(`${citation.metricCode}:${citation.rawValue}`);
    }
  }

  return { valid: mismatches.size === 0, mismatches: [...mismatches] };
}
