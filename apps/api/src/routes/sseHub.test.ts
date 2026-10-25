// Owner: R1. Task C-5: SSE hub unit tests with fake subscribers.
import { describe, expect, it, vi } from "vitest";
import type { AppEvent } from "@surplus/contracts";
import { DISCLAIMER_ID_V1, DISCLAIMER_TEXT_V1 } from "@surplus/contracts";
import {
  exampleAllocationPlan,
  exampleCashFlowSummary,
  exampleSurplusResult,
} from "@surplus/contracts/examples";
import { SseHub, formatSse } from "./sseHub";
import type { SseSubscriber } from "./sseHub";
import { MerchantIdSchema } from "@surplus/contracts";

function fakeSubscriber(merchantId: AppEvent["merchantId"]) {
  const chunks: string[] = [];
  let ended = false;
  const subscriber: SseSubscriber = {
    merchantId,
    send: (chunk) => chunks.push(chunk),
    end: () => {
      ended = true;
    },
  };
  return { subscriber, chunks, isEnded: () => ended };
}

function eventFor(
  merchantId: AppEvent["merchantId"],
  eventId: string,
  type: AppEvent["type"] = "payment.received",
): AppEvent {
  return {
    eventId,
    type,
    at: "2026-10-25T12:00:00Z",
    merchantId,
    deltaNetCents: 116470,
    updatedSummary: exampleCashFlowSummary,
    updatedSurplus: exampleSurplusResult,
    updatedPlan: exampleAllocationPlan,
  };
}

describe("formatSse", () => {
  it("emits id and data frames terminated by a blank line", () => {
    const frame = formatSse(eventFor("live_sandbox", "evt-1"));
    expect(frame).toContain("id: evt-1\n");
    expect(frame).toContain("data: {");
    expect(frame.endsWith("\n\n")).toBe(true);
  });
});

describe("SseHub", () => {
  it("sends a connected comment on subscribe", () => {
    const hub = new SseHub();
    const fake = fakeSubscriber("live_sandbox");
    hub.subscribe(fake.subscriber);
    expect(fake.chunks[0]).toBe(": connected\n\n");
  });

  it("broadcasts only to matching merchants", () => {
    const hub = new SseHub();
    const live = fakeSubscriber("live_sandbox");
    const persona = fakeSubscriber("persona_steady_retainer");
    hub.subscribe(live.subscriber);
    hub.subscribe(persona.subscriber);

    const delivered = hub.broadcast(eventFor("live_sandbox", "evt-1"));

    expect(delivered).toBe(1);
    expect(live.chunks.some((chunk) => chunk.includes("id: evt-1"))).toBe(true);
    expect(persona.chunks.some((chunk) => chunk.includes("id: evt-1"))).toBe(false);
  });

  it("stops delivering after unsubscribe", () => {
    const hub = new SseHub();
    const fake = fakeSubscriber("live_sandbox");
    const unsubscribe = hub.subscribe(fake.subscriber);
    unsubscribe();
    expect(hub.broadcast(eventFor("live_sandbox", "evt-1"))).toBe(0);
    expect(hub.count()).toBe(0);
  });

  it("sends heartbeats to all subscribers", () => {
    const hub = new SseHub();
    const a = fakeSubscriber("live_sandbox");
    const b = fakeSubscriber("live_sandbox");
    hub.subscribe(a.subscriber);
    hub.subscribe(b.subscriber);
    hub.heartbeat();
    expect(a.chunks.at(-1)).toBe(": heartbeat\n\n");
    expect(b.chunks.at(-1)).toBe(": heartbeat\n\n");
  });

  it("closes every subscriber", () => {
    const hub = new SseHub();
    const fake = fakeSubscriber("live_sandbox");
    hub.subscribe(fake.subscriber);
    hub.close();
    expect(fake.isEnded()).toBe(true);
    expect(hub.count()).toBe(0);
  });

  it("rejects events that violate the contract", () => {
    const hub = new SseHub();
    const bad = { ...eventFor("live_sandbox", "evt-1"), merchantId: "nope" };
    expect(() => hub.broadcast(bad as unknown as AppEvent)).toThrow();
  });

  it("uses contract enums for subscriber merchant ids", () => {
    expect(MerchantIdSchema.safeParse("live_sandbox").success).toBe(true);
    expect(DISCLAIMER_ID_V1).toBe("EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1");
    expect(DISCLAIMER_TEXT_V1.length).toBeGreaterThan(0);
  });

  it("can start and stop a heartbeat timer", () => {
    vi.useFakeTimers();
    try {
      const hub = new SseHub();
      const fake = fakeSubscriber("live_sandbox");
      hub.subscribe(fake.subscriber);
      const stop = hub.startHeartbeat(1000);
      vi.advanceTimersByTime(2500);
      const heartbeats = fake.chunks.filter((chunk) => chunk === ": heartbeat\n\n");
      expect(heartbeats.length).toBeGreaterThanOrEqual(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
