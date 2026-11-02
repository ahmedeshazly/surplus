// Owner: R5. Typed browser client for the existing Surplus API.
// Every response is parsed with the frozen @surplus/contracts Zod schemas.
// Scenario results are always requested from POST /api/scenario; this module
// never calculates a scenario locally.
import type {
  AdvisorResponse,
  AllocationPlan,
  AppEvent,
  CashFlowSummary,
  MerchantId,
  NormalizedTransaction,
  RiskProfile,
  ScenarioComparisonResult,
  ScenarioInput,
  SurplusResult,
} from "@surplus/contracts";
import {
  AdvisorResponseSchema,
  AllocationPlanSchema,
  AppEventSchema,
  CashFlowSummarySchema,
  NormalizedTransactionSchema,
  ScenarioComparisonResultSchema,
  SurplusResultSchema,
} from "@surplus/contracts";

const rawBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:4000";

export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, "");

interface Parser<T> {
  parse(value: unknown): T;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const record = asRecord(body);
    const error = record?.["error"];
    if (typeof error === "string" && error.length > 0) return error;
  } catch {
    // The body may not be JSON; fall through to the status text.
  }
  return response.statusText.length > 0 ? response.statusText : `HTTP ${response.status}`;
}

async function request<T>(path: string, schema: Parser<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status, await errorDetail(response));
  }

  const body: unknown = await response.json();
  try {
    return schema.parse(body);
  } catch {
    throw new ApiError(502, "The API returned a payload that does not match the shared contract.");
  }
}

export interface PlanBundle {
  summary: CashFlowSummary;
  surplus: SurplusResult;
  plan: AllocationPlan;
}

const planBundleParser: Parser<PlanBundle> = {
  parse(value: unknown): PlanBundle {
    const record = asRecord(value);
    if (record === null) {
      throw new Error("Plan response must be an object");
    }
    return {
      summary: CashFlowSummarySchema.parse(record["summary"]),
      surplus: SurplusResultSchema.parse(record["surplus"]),
      plan: AllocationPlanSchema.parse(record["plan"]),
    };
  },
};

export function fetchSummary(merchantId: MerchantId): Promise<CashFlowSummary> {
  return request(
    `/api/summary?merchantId=${encodeURIComponent(merchantId)}`,
    CashFlowSummarySchema,
  );
}

export function fetchTransactions(merchantId: MerchantId): Promise<NormalizedTransaction[]> {
  return request(
    `/api/transactions?merchantId=${encodeURIComponent(merchantId)}`,
    NormalizedTransactionSchema.array(),
  );
}

export function fetchPlan(
  merchantId: MerchantId,
  monthlyObligationsCents: number,
  riskProfile: RiskProfile,
): Promise<PlanBundle> {
  return request("/api/plan", planBundleParser, {
    method: "POST",
    body: JSON.stringify({ merchantId, monthlyObligationsCents, riskProfile }),
  });
}

export function fetchAdvisor(
  merchantId: MerchantId,
  monthlyObligationsCents: number,
  riskProfile: RiskProfile,
): Promise<AdvisorResponse> {
  return request("/api/advisor", AdvisorResponseSchema, {
    method: "POST",
    body: JSON.stringify({ merchantId, monthlyObligationsCents, riskProfile }),
  });
}

export function runScenario(input: ScenarioInput): Promise<ScenarioComparisonResult> {
  return request("/api/scenario", ScenarioComparisonResultSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type EventStreamStatus = "connecting" | "open" | "error";

export interface EventStreamHandlers {
  onEvent(event: AppEvent): void;
  onStatus(status: EventStreamStatus): void;
}

/**
 * Subscribes to GET /api/events. EventSource reconnects automatically; malformed
 * frames are ignored and never surface raw server text in the UI.
 */
export function subscribeToEvents(
  merchantId: MerchantId,
  handlers: EventStreamHandlers,
): () => void {
  handlers.onStatus("connecting");
  const source = new EventSource(
    `${API_BASE_URL}/api/events?merchantId=${encodeURIComponent(merchantId)}`,
  );

  source.onopen = () => {
    handlers.onStatus("open");
  };

  source.onerror = () => {
    handlers.onStatus("error");
  };

  source.onmessage = (message: MessageEvent<string>) => {
    if (typeof message.data !== "string" || message.data.length === 0) return;
    try {
      const body: unknown = JSON.parse(message.data);
      const event = AppEventSchema.parse(body);
      if (event.merchantId === merchantId) {
        handlers.onEvent(event);
      }
    } catch {
      // Ignore non-contract or malformed frames. The connection stays open.
    }
  };

  return () => {
    source.close();
  };
}

export function describeApiError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) {
      return "The request was rejected by the API validation layer. Check the inputs and try again.";
    }
    if (error.status === 404) {
      return "The API route is not available in this deployment.";
    }
    if (error.status === 502) {
      return error.message;
    }
    return `The API returned an error (${error.status}): ${error.message}`;
  }
  if (error instanceof Error && error.name === "TypeError") {
    return `Cannot reach the Surplus API at ${API_BASE_URL}. Start apps/api and try again.`;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Something went wrong while loading the dashboard.";
}
