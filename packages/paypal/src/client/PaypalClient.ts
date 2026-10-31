/**
 * Owner: R1. Task F-1: PaypalClient – production-grade PayPal REST client.
 *
 * Features:
 * - In-memory OAuth token cache; refreshes 5 minutes before 8h expiry.
 * - Single in-flight refresh (no stampede via a pending-promise guard).
 * - Exponential backoff with full jitter on network errors, 429, and 5xx.
 * - No retry on 4xx (except 429).
 * - Typed errors that NEVER contain secrets, tokens, or PayPal free text.
 * - Constructor takes config (clientId, secret, baseUrl) – env is read at the
 *   call site (apps/api), not inside this module.
 *
 * Security rules enforced here:
 * - Authorization header values are NEVER included in thrown errors.
 * - Free-text PayPal fields (notes, memos, custom_id, subject, messages,
 *   payer names) are NOT present in the returned types (see types.ts) and
 *   must be stripped by R2's normalizer before reaching the database.
 */

import type {
  PayPalBalancesResponse,
  PayPalDisputeItem,
  PayPalDisputesResponse,
  PayPalTokenResponse,
  PayPalTransactionSearchResponse,
  PayPalVerifyWebhookSignatureResponse,
} from "./types.js";
import { PayPalError } from "./errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Token lifetime is 28 800 seconds (8 hours). Refresh 5 min early. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** 31-day max window enforced by FACT-01. */
const MAX_WINDOW_DAYS = 31;

/** Default timeout for every fetch (ms). */
const DEFAULT_TIMEOUT_MS = 20_000;

/** Backoff config. */
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Public config type
// ---------------------------------------------------------------------------

export interface PayPalClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  /** Override fetch timeout in ms (default 20 000). */
  timeoutMs?: number;
  /** Override max backoff attempts (default 5). */
  maxAttempts?: number;
}

// ---------------------------------------------------------------------------
// Returned types for callers
// ---------------------------------------------------------------------------

export interface PayPalBalances {
  /** USD available balance in string form, e.g. "18500.00". R2 parses to cents. */
  available: { currencyCode: string; value: string };
  /** USD withheld balance. May be absent if no funds are withheld. */
  withheld: { currencyCode: string; value: string } | null;
  asOf: string;
}

/** Dispute data with ALL free text stripped. */
export interface PayPalSafeDispute {
  disputeId: string;
  status: string;
  /** Amount and currency code – structural, safe to store. */
  disputeAmount: { currencyCode: string; value: string };
  createTime: string;
}

// Re-export raw types so R2's normalizer can reference the internal shapes.
export type {
  PayPalTransactionSearchResponse,
  PayPalTransactionDetail,
  PayPalBalancesResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full-jitter exponential backoff.
 * Returns a random delay between 0 and min(BASE * 2^attempt, MAX).
 */
function jitteredDelay(attempt: number): number {
  const cap = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt), BACKOFF_MAX_MS);
  return Math.random() * cap;
}

/** Returns true for status codes that should trigger a retry. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// PaypalClient
// ---------------------------------------------------------------------------

export class PaypalClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  // Token cache
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0; // ms since epoch
  private refreshPromise: Promise<string> | null = null;

  constructor(config: PayPalClientConfig) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.baseUrl = config.baseUrl.replace(/\/$/, ""); // strip trailing slash
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? BACKOFF_MAX_ATTEMPTS;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Token management
  // ──────────────────────────────────────────────────────────────────────────

  /** Returns a valid Bearer token, refreshing early if within the margin. */
  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.cachedToken;
    }

    // Single in-flight refresh – prevent stampede.
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.#fetchNewToken().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  async #fetchNewToken(): Promise<string> {
    // Build Basic auth – never log or include in errors
    const creds = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network error";
      throw new PayPalError("NETWORK_ERROR", `OAuth token fetch failed: ${msg}`);
    }

    if (!res.ok) {
      throw new PayPalError("OAUTH_FAILED", `OAuth returned HTTP ${res.status}`, res.status);
    }

    let data: PayPalTokenResponse;
    try {
      data = (await res.json()) as PayPalTokenResponse;
    } catch {
      throw new PayPalError("PARSE_ERROR", "Could not parse OAuth token response");
    }

    this.cachedToken = data.access_token;
    // Calculate absolute expiry; use stated expires_in or fall back to 8h
    const expiresInMs = (data.expires_in ?? 28800) * 1000;
    this.tokenExpiresAt = Date.now() + expiresInMs;

    return data.access_token;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Generic authenticated fetch with retry/backoff
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Authenticated request with the shared timeout and retry policy.
   * `protected` so `PayPalOrdersClient` can reuse it without duplicating auth.
   */
  protected async request<T>(
    path: string,
    options?: { method?: string; body?: string; rawBody?: boolean },
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;

    let lastError: PayPalError | null = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) {
        await sleep(jitteredDelay(attempt - 1));
      }

      let res: Response;
      try {
        res = await fetch(url, {
          method: options?.method ?? "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: options?.body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "network error";
        lastError = new PayPalError("NETWORK_ERROR", `Fetch failed: ${msg}`);
        continue; // retry on network errors
      }

      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new PayPalError("PARSE_ERROR", `Could not parse response from ${path}`);
        }
      }

      if (isRetryable(res.status)) {
        lastError = new PayPalError("HTTP_ERROR", `HTTP ${res.status} from ${path}`, res.status);
        continue; // retry
      }

      // Non-retryable 4xx (excluding 429 caught above)
      throw new PayPalError("HTTP_ERROR", `HTTP ${res.status} from ${path}`, res.status);
    }

    throw (
      lastError ??
      new PayPalError("HTTP_ERROR", `All ${this.maxAttempts} attempts failed for ${path}`)
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // searchTransactions
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Fetches one page of transactions within [startDate, endDate].
   *
   * Enforces the 31-day maximum window (FACT-01). Throws WINDOW_TOO_LARGE if
   * the caller provides a wider range. R1's WindowedTransactionLoader (to be
   * built by R2) calls this in 31-day chunks.
   *
   * @param startDate RFC3339 UTC date-time string.
   * @param endDate   RFC3339 UTC date-time string.
   * @param page      1-indexed page number.
   * @param pageSize  Records per page (default 100, max 500).
   */
  async searchTransactions(
    startDate: string,
    endDate: string,
    page = 1,
    pageSize = 100,
  ): Promise<PayPalTransactionSearchResponse> {
    // Enforce 31-day window
    const startMs = Date.parse(startDate);
    const endMs = Date.parse(endDate);
    if (isNaN(startMs) || isNaN(endMs)) {
      throw new PayPalError(
        "HTTP_ERROR",
        "searchTransactions: startDate and endDate must be valid RFC3339 strings",
      );
    }
    const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_WINDOW_DAYS) {
      throw new PayPalError(
        "WINDOW_TOO_LARGE",
        `searchTransactions window is ${Math.ceil(diffDays)} days; maximum is ${MAX_WINDOW_DAYS} days (FACT-01).`,
      );
    }

    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      page: String(page),
      page_size: String(Math.min(pageSize, 500)),
      fields: "all",
    });

    return this.request<PayPalTransactionSearchResponse>(`/v1/reporting/transactions?${params}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // getBalances
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Fetches the account's available and withheld balances as-of `asOf`.
   * Returns only USD balances (non-USD are ignored; R2 handles multi-currency).
   *
   * @param asOf RFC3339 UTC date-time string (default: now).
   */
  async getBalances(asOf?: string): Promise<PayPalBalances> {
    const time = asOf ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const params = new URLSearchParams({ as_of_time: time, currency_code: "USD" });

    const data = await this.request<PayPalBalancesResponse>(`/v1/reporting/balances?${params}`);

    // Find the primary USD balance
    const usd = data.balances?.find(
      (b) =>
        b.available_balance?.currency_code === "USD" || b.total_balance?.currency_code === "USD",
    );

    return {
      available: {
        currencyCode: usd?.available_balance?.currency_code ?? "USD",
        value: usd?.available_balance?.value ?? "0.00",
      },
      withheld: usd?.withheld_balance
        ? {
            currencyCode: usd.withheld_balance.currency_code,
            value: usd.withheld_balance.value,
          }
        : null,
      asOf: data.as_of_time,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // listOpenDisputes
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Returns ALL open disputes across the three active states (FACT-04).
   * Pagination is handled internally. Only id, status, amount and currency
   * are returned – all free text (messages, notes, payer info) is stripped.
   *
   * @param pageSize Records per page (default 10, PayPal max is 50).
   */
  async listOpenDisputes(pageSize = 10): Promise<PayPalSafeDispute[]> {
    const states = "OPEN_INQUIRIES,REQUIRED_ACTION,UNDER_REVIEW";
    const results: PayPalSafeDispute[] = [];
    let nextUrl: string | null = null;
    let isFirst = true;

    while (isFirst || nextUrl) {
      isFirst = false;

      let data: PayPalDisputesResponse;
      if (nextUrl) {
        data = await this.request<PayPalDisputesResponse>(nextUrl);
      } else {
        const params = new URLSearchParams({
          dispute_state: states,
          page_size: String(Math.min(pageSize, 50)),
        });
        data = await this.request<PayPalDisputesResponse>(`/v1/customer/disputes?${params}`);
      }

      for (const item of data.items ?? []) {
        results.push(this.#safeDispute(item));
      }

      // Advance cursor
      const nextLink = data.links?.find((l) => l.rel === "next");
      nextUrl = nextLink?.href ?? null;
    }

    return results;
  }

  /** Strips all free text from a dispute record. */
  #safeDispute(item: PayPalDisputeItem): PayPalSafeDispute {
    return {
      disputeId: item.dispute_id,
      status: item.status,
      disputeAmount: {
        currencyCode: item.dispute_amount?.currency_code ?? "USD",
        value: item.dispute_amount?.value ?? "0.00",
      },
      createTime: item.create_time,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // verifyWebhookSignature
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Verifies a PayPal webhook signature.
   *
   * CRITICAL: `rawBody` must be the EXACT bytes received from PayPal before any
   * parsing. Even whitespace changes will invalidate the signature.
   *
   * Uses the five required headers:
   *   PAYPAL-TRANSMISSION-ID, PAYPAL-TRANSMISSION-TIME, PAYPAL-CERT-URL,
   *   PAYPAL-TRANSMISSION-SIG, PAYPAL-AUTH-ALGO
   *
   * @returns true if verification_status === "SUCCESS", false otherwise.
   */
  async verifyWebhookSignature(
    headers: {
      "paypal-transmission-id": string;
      "paypal-transmission-time": string;
      "paypal-cert-url": string;
      "paypal-transmission-sig": string;
      "paypal-auth-algo": string;
    },
    rawBody: string,
    webhookId: string,
  ): Promise<boolean> {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return false;
    }

    const payload = {
      auth_algo: headers["paypal-auth-algo"],
      cert_url: headers["paypal-cert-url"],
      transmission_id: headers["paypal-transmission-id"],
      transmission_sig: headers["paypal-transmission-sig"],
      transmission_time: headers["paypal-transmission-time"],
      webhook_id: webhookId,
      webhook_event: parsedBody,
    };

    let data: PayPalVerifyWebhookSignatureResponse;
    try {
      data = await this.request<PayPalVerifyWebhookSignatureResponse>(
        "/v1/notifications/verify-webhook-signature",
        { method: "POST", body: JSON.stringify(payload) },
      );
    } catch {
      // Network or HTTP error – treat as verification failure
      return false;
    }

    return data.verification_status === "SUCCESS";
  }
}
