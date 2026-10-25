// Owner: R1. Task C-5: TST-05 webhook controller tests.
import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "../app";
import { SseHub } from "./sseHub";
import type { SseSubscriber } from "./sseHub";
import { InMemoryWebhookStore } from "./webhookStore";
import { exampleDatasetLoader } from "./dataset";
import { LIVE_MERCHANT } from "./webhooks";

const SIGNATURE_HEADERS = {
  "paypal-transmission-id": "tid-1",
  "paypal-transmission-time": "2026-10-25T12:00:00Z",
  "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
  "paypal-transmission-sig": "sig-good",
  "paypal-auth-algo": "SHA256withRSA",
};

const CAPTURE_EVENT = {
  id: "WH-CAPTURE-1",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  create_time: "2026-10-25T12:00:00Z",
  resource: {
    id: "CAPTURE-1",
    status: "COMPLETED",
    create_time: "2026-10-25T11:59:00Z",
    amount: { currency_code: "USD", value: "1200.00" },
    seller_receivable_breakdown: {
      paypal_fee: { currency_code: "USD", value: "35.30" },
    },
    payer: { email_address: "buyer@example.com" },
    custom_id: "IGNORE ME - untrusted free text",
  },
};

const REFUND_EVENT = {
  id: "WH-REFUND-1",
  event_type: "PAYMENT.CAPTURE.REFUNDED",
  create_time: "2026-10-25T13:00:00Z",
  resource: {
    id: "REFUND-1",
    status: "COMPLETED",
    create_time: "2026-10-25T12:59:00Z",
    amount: { currency_code: "USD", value: "200.00" },
  },
};

function fakeSubscriber() {
  const chunks: string[] = [];
  const subscriber: SseSubscriber = {
    merchantId: LIVE_MERCHANT,
    send: (chunk) => chunks.push(chunk),
    end: () => undefined,
  };
  return { subscriber, chunks };
}

function harness(verifyResult = true) {
  const store = new InMemoryWebhookStore();
  store.seed(LIVE_MERCHANT, exampleDatasetLoader(LIVE_MERCHANT));
  const hub = new SseHub();
  const fake = fakeSubscriber();
  hub.subscribe(fake.subscriber);
  const seen: Array<{ headers: unknown; rawBody: string }> = [];
  const app = buildApp({
    loadDataset: () => store.getDataset(LIVE_MERCHANT) ?? exampleDatasetLoader(LIVE_MERCHANT),
    sseHub: hub,
    webhook: {
      store,
      verify: async (headers, rawBody) => {
        seen.push({ headers, rawBody });
        return verifyResult && headers["paypal-transmission-sig"] === "sig-good";
      },
      now: () => new Date("2026-10-25T12:00:00Z"),
    },
  });
  return { app, store, hub, fake, seen };
}

function post(app: ReturnType<typeof buildApp>, body: unknown) {
  return request(app)
    .post("/api/webhooks/paypal")
    .set(SIGNATURE_HEADERS)
    .set("Content-Type", "application/json")
    .send(JSON.stringify(body));
}

describe("POST /api/webhooks/paypal (TST-05)", () => {
  it("accepts a valid signed capture and updates the cached balance", async () => {
    const { app, store, fake } = harness();
    const before = store.balanceCents(LIVE_MERCHANT) ?? 0;
    const txBefore = store.transactionCount(LIVE_MERCHANT);

    const res = await post(app, CAPTURE_EVENT);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("received");
    expect(store.balanceCents(LIVE_MERCHANT)).toBe(before + 116470);
    expect(store.transactionCount(LIVE_MERCHANT)).toBe(txBefore + 1);
    expect(store.eventCount()).toBe(1);
    expect(
      fake.chunks.some((chunk) => chunk.includes("payment.received")),
    ).toBe(true);
    expect(
      fake.chunks.some((chunk) => chunk.includes("plan.updated")),
    ).toBe(true);
  });

  it("verifies the exact raw bytes before anything is written", async () => {
    const { app, seen, store } = harness();
    await post(app, CAPTURE_EVENT);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.rawBody).toBe(JSON.stringify(CAPTURE_EVENT));
    expect(store.eventCount()).toBe(1);
  });

  it("rejects a tampered signature with zero database change", async () => {
    const { app, store, fake } = harness(false);
    const before = store.balanceCents(LIVE_MERCHANT);
    const txBefore = store.transactionCount(LIVE_MERCHANT);

    const res = await post(app, CAPTURE_EVENT);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_signature");
    expect(store.balanceCents(LIVE_MERCHANT)).toBe(before);
    expect(store.transactionCount(LIVE_MERCHANT)).toBe(txBefore);
    expect(store.eventCount()).toBe(0);
    expect(fake.chunks).toHaveLength(1); // only the connected comment
  });

  it("treats a replayed event id as a duplicate with no double count", async () => {
    const { app, store } = harness();
    const first = await post(app, CAPTURE_EVENT);
    const second = await post(app, CAPTURE_EVENT);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("duplicate");
    expect(store.eventCount()).toBe(1);
    expect(store.transactionCount(LIVE_MERCHANT)).toBe(2); // seed + one capture
    expect(store.balanceCents(LIVE_MERCHANT)).toBe(
      (exampleDatasetLoader(LIVE_MERCHANT).availableBalanceCents ?? 0) + 116470,
    );
  });

  it("applies a refund as a negative net movement", async () => {
    const { app, store } = harness();
    const before = store.balanceCents(LIVE_MERCHANT) ?? 0;

    const res = await post(app, REFUND_EVENT);

    expect(res.status).toBe(200);
    expect(store.balanceCents(LIVE_MERCHANT)).toBe(before - 20000);
  });

  it("acknowledges unknown event types without writing", async () => {
    const { app, store } = harness();
    const res = await post(app, { ...CAPTURE_EVENT, event_type: "SOMETHING.ELSE" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(store.eventCount()).toBe(0);
  });

  it("rejects a request with missing signature headers", async () => {
    const { app, store } = harness();
    const res = await request(app)
      .post("/api/webhooks/paypal")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(CAPTURE_EVENT));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_signature_headers");
    expect(store.eventCount()).toBe(0);
  });

  it("rejects malformed capture amounts without writing", async () => {
    const { app, store } = harness();
    const bad = {
      ...CAPTURE_EVENT,
      resource: {
        ...CAPTURE_EVENT.resource,
        amount: { currency_code: "USD", value: "12.345" },
      },
    };
    const res = await post(app, bad);
    expect(res.status).toBe(400);
    expect(store.eventCount()).toBe(0);
  });
});

describe("GET /api/events", () => {
  it("returns 400 when merchantId is missing", async () => {
    const { app } = harness();
    const res = await request(app).get("/api/events");
    expect(res.status).toBe(400);
  });
});
