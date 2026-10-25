// Owner: R1. Task C-5: TEMPORARY webhook persistence and normalization adapters.
//
// R2 owns the real implementations:
//   - packages/paypal/src/sources/db.ts        (SQLite tables, transactions)
//   - packages/paypal/src/sources/normalizer.ts (PayPal payload -> NormalizedTransaction)
// Both are absent from main today, so this module provides a marked in-memory
// implementation with the exact call shapes the controller needs. Swapping in
// R2's modules is a constructor change in apps/api/src/server.ts only.
//
// Free text is never read: only ids, amount fields, status and timestamps are
// touched. Payer email is hashed, never stored.
import { createHash } from "node:crypto";
import type {
  BalanceSource,
  MerchantId,
  NormalizedTransaction,
  OpenDisputesSummary,
} from "@surplus/contracts";
import type { MerchantDataset } from "./dataset";

/** Zero disputes for live merchants until R2's dispute sync populates them. */
export const EMPTY_DISPUTES: OpenDisputesSummary = {
  count: 0,
  totalAmountCents: 0,
  unheldAmountCents: 0,
};

export interface CaptureEventInput {
  merchantId: MerchantId;
  captureId: string;
  occurredAt: string;
  grossCents: number;
  feeCents: number;
  payerEmailHash: string;
}

export interface RefundEventInput {
  merchantId: MerchantId;
  refundId: string;
  occurredAt: string;
  amountCents: number;
  payerEmailHash: string;
}

/**
 * TEMPORARY normalizer. TODO(R2): replace with sources/normalizer.ts.
 * Kept minimal and pure so it can be unit-tested.
 */
export function normalizeCapture(input: CaptureEventInput): NormalizedTransaction {
  return {
    id: input.captureId,
    merchantId: input.merchantId,
    occurredAt: input.occurredAt,
    monthBucket: input.occurredAt.slice(0, 7),
    kind: "income",
    grossCents: input.grossCents,
    feeCents: input.feeCents,
    netCents: input.grossCents - input.feeCents,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: input.payerEmailHash,
    source: "live",
  };
}

export function normalizeRefund(input: RefundEventInput): NormalizedTransaction {
  return {
    id: input.refundId,
    merchantId: input.merchantId,
    occurredAt: input.occurredAt,
    monthBucket: input.occurredAt.slice(0, 7),
    kind: "refund",
    grossCents: input.amountCents,
    feeCents: 0,
    netCents: -input.amountCents,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: input.payerEmailHash,
    source: "live",
  };
}

/** First 8 hex chars of SHA-256. Payer email never leaves this function. */
export function hashPayerRef(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

interface MerchantState {
  transactions: NormalizedTransaction[];
  availableBalanceCents: number;
  balanceSource: BalanceSource;
  openDisputes: OpenDisputesSummary;
  excludedNonUsdCount: number;
  eventIds: Set<string>;
}

export interface ApplyEventInput {
  eventId: string;
  merchantId: MerchantId;
  transaction: NormalizedTransaction;
  deltaNetCents: number;
}

/**
 * TEMPORARY in-memory store. TODO(R2): replace with better-sqlite3 WAL tables.
 * `applyEvent` is atomic by construction (single synchronous mutation), matching
 * the "one DB transaction" requirement of C-5.
 */
export class InMemoryWebhookStore {
  readonly #merchants = new Map<MerchantId, MerchantState>();

  seed(merchantId: MerchantId, dataset: MerchantDataset): void {
    this.#merchants.set(merchantId, {
      transactions: [...dataset.transactions],
      availableBalanceCents: dataset.availableBalanceCents,
      balanceSource: dataset.balanceSource,
      openDisputes: dataset.openDisputes,
      excludedNonUsdCount: dataset.excludedNonUsdCount,
      eventIds: new Set(),
    });
  }

  hasEvent(eventId: string): boolean {
    for (const state of this.#merchants.values()) {
      if (state.eventIds.has(eventId)) return true;
    }
    return false;
  }

  /** Returns false when the event id was already applied (idempotency). */
  applyEvent(input: ApplyEventInput): boolean {
    const state = this.#merchants.get(input.merchantId);
    if (state === undefined) return false;
    if (state.eventIds.has(input.eventId)) return false;
    state.eventIds.add(input.eventId);
    state.transactions.push(input.transaction);
    state.availableBalanceCents = state.availableBalanceCents + input.deltaNetCents;
    state.balanceSource = "LIVE_WEBHOOK_ADJUSTED";
    return true;
  }

  getDataset(merchantId: MerchantId): MerchantDataset | undefined {
    const state = this.#merchants.get(merchantId);
    if (state === undefined) return undefined;
    return {
      transactions: [...state.transactions],
      availableBalanceCents: state.availableBalanceCents,
      balanceSource: state.balanceSource,
      openDisputes: state.openDisputes,
      excludedNonUsdCount: state.excludedNonUsdCount,
    };
  }

  /** Test/inspection helpers; no business logic. */
  balanceCents(merchantId: MerchantId): number | undefined {
    return this.#merchants.get(merchantId)?.availableBalanceCents;
  }

  transactionCount(merchantId: MerchantId): number {
    return this.#merchants.get(merchantId)?.transactions.length ?? 0;
  }

  eventCount(): number {
    let total = 0;
    for (const state of this.#merchants.values()) total += state.eventIds.size;
    return total;
  }
}
