// Owner: R1. Task C-12: seed-on-boot must not mix fixture data into live.
import { describe, expect, it } from "vitest";
import { EMPTY_LIVE_DATASET, seedOnBoot } from "./seed";
import { InMemoryWebhookStore } from "./webhookStore";

describe("seedOnBoot", () => {
  it("starts live_sandbox empty instead of copying fixture data", () => {
    const store = new InMemoryWebhookStore();
    seedOnBoot(store);

    expect(store.transactionCount("live_sandbox")).toBe(0);
    expect(store.balanceCents("live_sandbox")).toBe(0);

    const dataset = store.getDataset("live_sandbox");
    expect(dataset?.transactions).toEqual([]);
    expect(dataset?.balanceSource).toBe("LIVE_WEBHOOK_ADJUSTED");
    expect(dataset?.openDisputes).toEqual(EMPTY_LIVE_DATASET.openDisputes);
  });

  it("is idempotent and clears previously applied events", async () => {
    const store = new InMemoryWebhookStore();
    seedOnBoot(store);
    store.applyEvent({
      eventId: "WH-1",
      merchantId: "live_sandbox",
      transaction: {
        id: "C-1",
        merchantId: "live_sandbox",
        occurredAt: "2026-10-25T12:00:00Z",
        monthBucket: "2026-10",
        kind: "income",
        grossCents: 1000,
        feeCents: 0,
        netCents: 1000,
        currency: "USD",
        status: "COMPLETED",
        counterpartyHash: "aaaaaaaa",
        source: "live",
      },
      deltaNetCents: 1000,
    });
    expect(store.eventCount()).toBe(1);

    seedOnBoot(store);

    expect(store.eventCount()).toBe(0);
    expect(store.transactionCount("live_sandbox")).toBe(0);
    expect(store.balanceCents("live_sandbox")).toBe(0);
  });
});
