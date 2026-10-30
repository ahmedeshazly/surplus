// Owner: R3 (exclusively). Engine input validation guards: fail fast with readable errors.
import { describe, expect, it } from "vitest";
import type { NormalizedTransaction } from "@surplus/contracts";
import {
  normalizeDisputes,
  requireBalanceSource,
  requireIsoUtc,
  requireMerchantId,
  requireNonNegativeInt,
  requireRiskProfile,
  requireSafeInt,
  requireTransactions,
} from "./validate";

function row(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    id: "t-guard",
    merchantId: "live_sandbox",
    occurredAt: "2026-09-05T12:00:00Z",
    monthBucket: "2026-09",
    kind: "income",
    grossCents: 100000,
    feeCents: 0,
    netCents: 100000,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "a1b2c3d4",
    source: "fixture",
    ...overrides,
  };
}

describe("validate guards", () => {
  it("requireSafeInt / requireNonNegativeInt", () => {
    expect(requireSafeInt(5, "v")).toBe(5);
    expect(() => requireSafeInt(1.5, "v")).toThrow(/v/);
    expect(() => requireSafeInt(Number.NaN, "v")).toThrow(/v/);
    expect(() => requireSafeInt(Number.MAX_SAFE_INTEGER + 1, "v")).toThrow(/v/);
    expect(requireNonNegativeInt(0, "v")).toBe(0);
    expect(() => requireNonNegativeInt(-1, "v")).toThrow(/v/);
  });

  it("requireMerchantId / requireRiskProfile / requireBalanceSource", () => {
    expect(requireMerchantId("live_sandbox")).toBe("live_sandbox");
    expect(() => requireMerchantId("nope" as never)).toThrow(/merchantId/);
    expect(requireRiskProfile("GROWTH")).toBe("GROWTH");
    expect(() => requireRiskProfile("wild" as never)).toThrow(/riskProfile/);
    expect(requireBalanceSource("PAYPAL_REPORTING_API")).toBe("PAYPAL_REPORTING_API");
    expect(() => requireBalanceSource("X" as never)).toThrow(/balanceSource/);
  });

  it("requireIsoUtc", () => {
    expect(requireIsoUtc("2026-10-01T00:00:00Z", "refreshedAt")).toBe("2026-10-01T00:00:00Z");
    expect(() => requireIsoUtc("yesterday" as never, "refreshedAt")).toThrow(
      /refreshedAt must be an ISO-8601 UTC instant/,
    );
    expect(() => requireIsoUtc("2026-10-01T00:00:00+02:00", "asOf")).toThrow(/asOf/);
  });

  it("requireTransactions", () => {
    expect(() => requireTransactions("nope" as never)).toThrow(/must be an array/);
    expect(() => requireTransactions([row({ grossCents: 1.5 })])).toThrow(
      /transactions\[0\] violates the contract/,
    );
  });

  it("normalizeDisputes: defaults to zeros and validates against the contract", () => {
    expect(normalizeDisputes(undefined)).toEqual({
      count: 0,
      totalAmountCents: 0,
      unheldAmountCents: 0,
    });
    expect(
      normalizeDisputes({ count: 1, totalAmountCents: 5000, unheldAmountCents: 5000 }),
    ).toEqual({ count: 1, totalAmountCents: 5000, unheldAmountCents: 5000 });
    expect(() =>
      normalizeDisputes({ count: 1, totalAmountCents: -5000, unheldAmountCents: 0 }),
    ).toThrow(/openDisputes violates the contract/);
  });
});
