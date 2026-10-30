// Owner: R3 (exclusively). Engine input validation. Fail fast on contract violations with
// readable errors; the engine is pure and synchronous and never "fixes" caller data.
import {
  BalanceSourceSchema,
  IsoUtcSchema,
  MerchantIdSchema,
  NormalizedTransactionSchema,
  OpenDisputesSummarySchema,
  RiskProfileSchema,
} from "@surplus/contracts";
import type {
  BalanceSource,
  MerchantId,
  NormalizedTransaction,
  OpenDisputesSummary,
  RiskProfile,
} from "@surplus/contracts";

export function requireSafeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, got: ${String(value)}`);
  }
  return value;
}

export function requireNonNegativeInt(value: number, label: string): number {
  requireSafeInt(value, label);
  if (value < 0) {
    throw new Error(`${label} must be >= 0, got: ${String(value)}`);
  }
  return value;
}

export function requireMerchantId(value: MerchantId): MerchantId {
  const parsed = MerchantIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `merchantId must be one of ${MerchantIdSchema.options.join(", ")}, got: '${String(value)}'`,
    );
  }
  return value;
}

export function requireRiskProfile(value: RiskProfile): RiskProfile {
  const parsed = RiskProfileSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `riskProfile must be one of ${RiskProfileSchema.options.join(", ")}, got: '${String(value)}'`,
    );
  }
  return value;
}

export function requireBalanceSource(value: BalanceSource): BalanceSource {
  const parsed = BalanceSourceSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `balanceSource must be one of ${BalanceSourceSchema.options.join(", ")}, got: '${String(value)}'`,
    );
  }
  return value;
}

export function requireIsoUtc(value: string, label = "asOf"): string {
  const parsed = IsoUtcSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} must be an ISO-8601 UTC instant ('Z'), got: '${String(value)}'`);
  }
  return value;
}

export function requireTransactions(value: NormalizedTransaction[]): NormalizedTransaction[] {
  if (!Array.isArray(value)) {
    throw new Error("transactions must be an array of NORMALIZED_TRANSACTION objects");
  }
  const parsed = zArrayTyped(value);
  return parsed;
}

function zArrayTyped(transactions: NormalizedTransaction[]): NormalizedTransaction[] {
  for (let i = 0; i < transactions.length; i++) {
    const parsed = NormalizedTransactionSchema.safeParse(transactions[i]);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
        .join("; ");
      throw new Error(`transactions[${i}] violates the contract: ${issues}`);
    }
  }
  return transactions;
}

export function normalizeDisputes(value: OpenDisputesSummary | undefined): OpenDisputesSummary {
  if (value === undefined) {
    return { count: 0, totalAmountCents: 0, unheldAmountCents: 0 };
  }
  const parsed = OpenDisputesSummarySchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
      .join("; ");
    throw new Error(`openDisputes violates the contract: ${issues}`);
  }
  return parsed.data;
}
