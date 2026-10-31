/**
 * Owner: R1. Task F-1 extension: PayPal Orders v2 client.
 *
 * Creates and captures Sandbox orders for the live demo. It extends
 * PaypalClient so the OAuth cache, timeout, retry/backoff and error policy are
 * identical. Amounts are always integer cents on the way in and out, and only
 * a hashed payer identity is returned: PayPal free text (notes, memos, custom
 * ids, payer names) never leaves this module.
 */

import { createHash } from "node:crypto";
import { PayPalError } from "./errors.js";
import { PaypalClient } from "./PaypalClient.js";
import type { PayPalCaptureResponse, PayPalOrderResponse } from "./types.js";

export interface PayPalOrder {
  orderId: string;
  status: string;
}

export interface PayPalCapture {
  captureId: string;
  status: string;
  currencyCode: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  /** First 8 hex chars of SHA-256 of the lowercased payer email, or null. */
  payerEmailHash: string | null;
  occurredAt: string;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

/** Integer cents -> exact PayPal decimal string. Never uses floating point. */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new PayPalError(
      "INVALID_AMOUNT",
      "Amount must be a non-negative integer number of cents",
    );
  }
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

/** PayPal decimal string -> integer cents. Rejects malformed or unsafe values. */
export function decimalStringToCents(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) return undefined;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const total = whole * 100 + fraction;
  return Number.isSafeInteger(total) ? total : undefined;
}

function hashPayerEmail(email: string | undefined): string | null {
  if (email === undefined || email.length === 0) return null;
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 8);
}

export class PayPalOrdersClient extends PaypalClient {
  /** POST /v2/checkout/orders — create a CAPTURE-intent order. */
  async createOrder(amountCents: number, currencyCode = "USD"): Promise<PayPalOrder> {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new PayPalError(
        "INVALID_AMOUNT",
        "Order amount must be a positive integer number of cents",
      );
    }
    if (!CURRENCY_PATTERN.test(currencyCode)) {
      throw new PayPalError("INVALID_AMOUNT", "currencyCode must be a 3-letter ISO code");
    }

    const body = JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currencyCode,
            value: centsToDecimalString(amountCents),
          },
        },
      ],
    });

    const data = await this.request<PayPalOrderResponse>("/v2/checkout/orders", {
      method: "POST",
      body,
    });

    if (typeof data.id !== "string" || data.id.length === 0) {
      throw new PayPalError("PARSE_ERROR", "Malformed create-order response");
    }
    return { orderId: data.id, status: data.status ?? "UNKNOWN" };
  }

  /** POST /v2/checkout/orders/{id}/capture — capture and return integer cents. */
  async captureOrder(orderId: string): Promise<PayPalCapture> {
    if (orderId.trim().length === 0) {
      throw new PayPalError("INVALID_AMOUNT", "orderId is required");
    }

    const data = await this.request<PayPalCaptureResponse>(
      `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      { method: "POST", body: "{}" },
    );

    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    if (capture === undefined) {
      throw new PayPalError("PARSE_ERROR", "Malformed capture response: no capture found");
    }

    const breakdown = capture.seller_receivable_breakdown;
    const grossCents =
      decimalStringToCents(capture.amount?.value) ??
      decimalStringToCents(breakdown?.gross_amount?.value);
    if (grossCents === undefined) {
      throw new PayPalError("PARSE_ERROR", "Malformed capture response: missing gross amount");
    }
    const feeCents = decimalStringToCents(breakdown?.paypal_fee?.value) ?? 0;
    const currencyCode =
      capture.amount?.currency_code ?? breakdown?.gross_amount?.currency_code ?? "USD";

    return {
      captureId: capture.id,
      status: capture.status,
      currencyCode,
      grossCents,
      feeCents,
      netCents: grossCents - feeCents,
      payerEmailHash: hashPayerEmail(data.payer?.email_address),
      occurredAt: capture.create_time ?? new Date().toISOString(),
    };
  }
}
