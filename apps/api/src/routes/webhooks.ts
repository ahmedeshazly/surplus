// Owner: R1. Task C-5: PayPal webhook controller.
//
// Order is non-negotiable:
//   1. verify the signature over the EXACT raw bytes
//   2. parse the event
//   3. dedupe by event id
//   4. apply the event atomically
//   5. recompute and broadcast
// Any failure before step 4 performs zero writes.
import type { Request, Response } from "express";
import type { AppEvent, MerchantId } from "@surplus/contracts";
import {
  computeAllocationPlan,
  computeCashFlowSummary,
  computeSurplus,
} from "@surplus/engine";
import type { SseHub } from "./sseHub";
import {
  EMPTY_DISPUTES,
  hashPayerRef,
  normalizeCapture,
  normalizeRefund,
} from "./webhookStore";
import type { InMemoryWebhookStore } from "./webhookStore";

/** Every live capture belongs to the single demo merchant. */
export const LIVE_MERCHANT: MerchantId = "live_sandbox";

export interface WebhookVerifierHeaders {
  "paypal-transmission-id": string;
  "paypal-transmission-time": string;
  "paypal-cert-url": string;
  "paypal-transmission-sig": string;
  "paypal-auth-algo": string;
}

export interface WebhookDeps {
  verify: (headers: WebhookVerifierHeaders, rawBody: string) => Promise<boolean>;
  store: InMemoryWebhookStore;
  hub: SseHub;
  now?: () => Date;
}

export type WebhookHandler = (req: Request, res: Response) => Promise<void>;

const SUPPORTED_CAPTURE = "PAYMENT.CAPTURE.COMPLETED";
const SUPPORTED_REFUNDS = new Set([
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REFUND",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** "1200.00" -> 120000. Integer-only; rejects malformed values. */
export function decimalToCents(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (match === null) return undefined;
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? "").padEnd(2, "0"));
  const total = whole * 100 + frac;
  return Number.isSafeInteger(total) ? total : undefined;
}

function readHeaders(req: Request): WebhookVerifierHeaders | undefined {
  const header = (name: string): string | undefined => {
    const value = req.headers[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };
  const headers = {
    "paypal-transmission-id": header("paypal-transmission-id"),
    "paypal-transmission-time": header("paypal-transmission-time"),
    "paypal-cert-url": header("paypal-cert-url"),
    "paypal-transmission-sig": header("paypal-transmission-sig"),
    "paypal-auth-algo": header("paypal-auth-algo"),
  };
  return Object.values(headers).every((value) => value !== undefined)
    ? (headers as WebhookVerifierHeaders)
    : undefined;
}

function badRequest(res: Response, error: string): void {
  res.status(400).json({ error });
}

/**
 * Builds the POST /api/webhooks/paypal handler. The caller must mount it with
 * a raw-body parser so `req.body` is the untouched Buffer.
 */
export function createWebhookHandler(deps: WebhookDeps): WebhookHandler {
  const clock = deps.now ?? (() => new Date());

  return async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : undefined;
    if (rawBody === undefined) {
      badRequest(res, "raw_body_required");
      return;
    }

    const headers = readHeaders(req);
    if (headers === undefined) {
      badRequest(res, "missing_signature_headers");
      return;
    }

    // Verify BEFORE parsing or writing anything.
    let verified = false;
    try {
      verified = await deps.verify(headers, rawBody);
    } catch {
      verified = false;
    }
    if (!verified) {
      badRequest(res, "invalid_signature");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      badRequest(res, "invalid_json");
      return;
    }

    const event = asRecord(parsed);
    const eventId = asString(event?.["id"]);
    const eventType = asString(event?.["event_type"]);
    if (eventId === undefined || eventType === undefined) {
      badRequest(res, "invalid_event");
      return;
    }

    // Idempotency: replay returns 200 without touching the database.
    if (deps.store.hasEvent(eventId)) {
      res.status(200).json({ status: "duplicate" });
      return;
    }

    const resource = asRecord(event?.["resource"]);
    if (resource === undefined) {
      badRequest(res, "invalid_event");
      return;
    }

    const merchantId = LIVE_MERCHANT;
    const occurredAt =
      asString(resource["create_time"]) ??
      asString(event?.["create_time"]) ??
      clock().toISOString();
    const payer = asRecord(resource["payer"]);
    const payerEmail = asString(payer?.["email_address"]) ?? "";
    const payerEmailHash = hashPayerRef(payerEmail);

    let transaction;
    let appEventType: AppEvent["type"];
    if (eventType === SUPPORTED_CAPTURE) {
      const captureId = asString(resource["id"]);
      const amount = asRecord(resource["amount"]);
      const grossCents = decimalToCents(amount?.["value"]);
      if (captureId === undefined || grossCents === undefined) {
        badRequest(res, "invalid_event");
        return;
      }
      const breakdown = asRecord(resource["seller_receivable_breakdown"]);
      const feeAmount = asRecord(breakdown?.["paypal_fee"]);
      const feeCents = decimalToCents(feeAmount?.["value"]) ?? 0;
      transaction = normalizeCapture({
        merchantId,
        captureId,
        occurredAt,
        grossCents,
        feeCents,
        payerEmailHash,
      });
      appEventType = "payment.received";
    } else if (SUPPORTED_REFUNDS.has(eventType)) {
      const refundId = asString(resource["id"]);
      const amount = asRecord(resource["amount"]);
      const amountCents = decimalToCents(amount?.["value"]);
      if (refundId === undefined || amountCents === undefined) {
        badRequest(res, "invalid_event");
        return;
      }
      transaction = normalizeRefund({
        merchantId,
        refundId,
        occurredAt,
        amountCents,
        payerEmailHash,
      });
      appEventType = "refund.processed";
    } else {
      // Unknown or unsupported types are acknowledged and ignored (PayPal retries otherwise).
      res.status(200).json({ status: "ignored" });
      return;
    }

    const applied = deps.store.applyEvent({
      eventId,
      merchantId,
      transaction,
      deltaNetCents: transaction.netCents,
    });
    if (!applied) {
      res.status(200).json({ status: "duplicate" });
      return;
    }

    // Recompute after the write commits, then notify subscribers.
    try {
      const dataset = deps.store.getDataset(merchantId);
      if (dataset !== undefined) {
        const asOf = clock().toISOString();
        const summary = computeCashFlowSummary({
          merchantId,
          transactions: dataset.transactions,
          asOf,
          openDisputes: dataset.openDisputes ?? EMPTY_DISPUTES,
          excludedNonUsdCount: dataset.excludedNonUsdCount,
        });
        const surplus = computeSurplus({
          merchantId,
          transactions: dataset.transactions,
          asOf,
          availableBalanceCents: dataset.availableBalanceCents,
          balanceSource: dataset.balanceSource,
          riskProfile: "BALANCED",
          openDisputes: dataset.openDisputes ?? EMPTY_DISPUTES,
          excludedNonUsdCount: dataset.excludedNonUsdCount,
        });
        const plan = computeAllocationPlan(surplus);
        const base: AppEvent = {
          eventId: `${eventId}:${appEventType}`,
          type: appEventType,
          at: asOf,
          merchantId,
          deltaNetCents: transaction.netCents,
          updatedSummary: summary,
          updatedSurplus: surplus,
          updatedPlan: plan,
        };
        deps.hub.broadcast(base);
        deps.hub.broadcast({ ...base, eventId: `${eventId}:plan.updated`, type: "plan.updated" });
      }
    } catch {
      // The event is already persisted; broadcasting is best-effort.
    }

    res.status(200).json({ status: "received" });
  };
}
