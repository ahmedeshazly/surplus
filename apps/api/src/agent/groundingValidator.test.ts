import { DISCLAIMER_ID_V1 } from "@surplus/contracts";
import {
  exampleAllocationPlan,
  exampleCashFlowSummary,
  exampleSurplusResult,
} from "@surplus/contracts/examples";
import { describe, expect, it } from "vitest";
import type { AdvisorDraft } from "./groundingValidator.js";
import { validateAdvisorOutput } from "./groundingValidator.js";

const outputs = [exampleCashFlowSummary, exampleSurplusResult, exampleAllocationPlan];

function draft(narrativeMarkdown: string): AdvisorDraft {
  return {
    narrativeMarkdown,
    citedNumbers: [
      { metricCode: "safe_surplus_cents", rawValue: 420000, formattedText: "$4,200.00" },
    ],
    disclaimerId: DISCLAIMER_ID_V1,
  };
}

describe("validateAdvisorOutput", () => {
  it("accepts claims grounded in deterministic tool output", () => {
    expect(validateAdvisorOutput(draft("Safe surplus is $4,200.00."), outputs)).toEqual({
      valid: true,
      mismatches: [],
    });
  });

  it.each(["$99,999", "AAPL", "SPY", "guaranteed", "risk-free"])(
    "rejects injected or unsafe token %s",
    (token) => {
      const result = validateAdvisorOutput(draft(`Consider ${token}.`), outputs);
      expect(result.valid).toBe(false);
      expect(result.mismatches).toContain(token);
    },
  );

  it("rejects ungrounded citations and a missing mandatory disclaimer", () => {
    const result = validateAdvisorOutput(
      {
        ...draft("Safe surplus is $4,200.00."),
        citedNumbers: [
          { metricCode: "invented", rawValue: 987654321, formattedText: "invented value" },
        ],
        disclaimerId: "EDUCATIONAL_NOT_FINANCIAL_ADVICE_V0" as typeof DISCLAIMER_ID_V1,
      },
      outputs,
    );
    expect(result.mismatches).toEqual(
      expect.arrayContaining([
        "disclaimer:EDUCATIONAL_NOT_FINANCIAL_ADVICE_V0",
        "invented:987654321",
      ]),
    );
  });

  it("allows explicitly whitelisted structural constants in citations", () => {
    const result = validateAdvisorOutput(
      {
        ...draft("The analysis uses 12 completed months."),
        citedNumbers: [
          { metricCode: "completed_months", rawValue: 12, formattedText: "12 months" },
        ],
      },
      outputs,
    );
    expect(result.valid).toBe(true);
  });

  it("uses a strict one-cent tolerance for money citations", () => {
    const accepted = validateAdvisorOutput(
      {
        ...draft("Safe surplus is $4,200.00."),
        citedNumbers: [
          { metricCode: "safe_surplus_cents", rawValue: 420001, formattedText: "$4,200.00" },
        ],
      },
      outputs,
    );
    const rejected = validateAdvisorOutput(
      {
        ...draft("Safe surplus is $4,200.00."),
        citedNumbers: [
          { metricCode: "safe_surplus_cents", rawValue: 420002, formattedText: "$4,200.00" },
        ],
      },
      outputs,
    );
    expect(accepted.valid).toBe(true);
    expect(rejected.mismatches).toContain("safe_surplus_cents:420002");
  });

  it("does not accept a grounded currency prefix followed by extra decimal digits", () => {
    const result = validateAdvisorOutput(draft("Safe surplus is $4,200.000."), outputs);
    expect(result.valid).toBe(false);
  });

  it("checks unsupported percentages followed by sentence punctuation", () => {
    const result = validateAdvisorOutput(draft("The projected return is 73.37%."), outputs);
    expect(result.mismatches).toContain("73.37%");
  });
});
