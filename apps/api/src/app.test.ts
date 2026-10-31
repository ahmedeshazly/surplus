// Owner: R1. Task F-9: route contract tests (supertest).
import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildApp } from "./app";
import type { MerchantDataset } from "./routes/dataset";
import { exampleOpenDisputesSummary } from "@surplus/contracts/examples";
import type { NormalizedTransaction } from "@surplus/contracts";

function months(): string[] {
  return [
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
    "2026-09",
  ];
}

/** Deterministic 12-month dataset so the engine reaches modelStatus OK. */
function richDataset(): MerchantDataset {
  const transactions: NormalizedTransaction[] = months().map((month, index) => ({
    id: `tx-${month}`,
    merchantId: "persona_steady_retainer",
    occurredAt: `${month}-10T12:00:00Z`,
    monthBucket: month,
    kind: "income",
    grossCents: 200000 + index * 1000,
    feeCents: 5000,
    netCents: 195000 + index * 1000,
    currency: "USD",
    status: "COMPLETED",
    counterpartyHash: "deadbeef",
    source: "fixture",
  }));
  return {
    transactions,
    availableBalanceCents: 2_000_000,
    balanceSource: "FIXTURE",
    openDisputes: exampleOpenDisputesSummary,
    excludedNonUsdCount: 0,
  };
}

const app = buildApp({
  loadDataset: () => richDataset(),
  webOrigin: "http://localhost:3000",
});

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, service: "surplus-api" });
  });
});

describe("GET /api/summary", () => {
  it("returns 200 for a valid merchant", async () => {
    const res = await request(app).get("/api/summary?merchantId=persona_steady_retainer");
    expect(res.status).toBe(200);
    expect(res.body.merchantId).toBe("persona_steady_retainer");
    expect(res.body.completedMonthsCount).toBe(12);
  });

  it("returns 400 for a missing merchant", async () => {
    const res = await request(app).get("/api/summary");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 for an unknown merchant", async () => {
    const res = await request(app).get("/api/summary?merchantId=nope");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/surplus", () => {
  it("returns 200 with a valid surplus result", async () => {
    const res = await request(app).get(
      "/api/surplus?merchantId=persona_steady_retainer&riskProfile=BALANCED&monthlyObligationsCents=300000",
    );
    expect(res.status).toBe(200);
    expect(res.body.modelStatus).toBe("OK");
    expect(Number.isInteger(res.body.safeSurplusCents)).toBe(true);
  });

  it("returns 400 for an invalid risk profile", async () => {
    const res = await request(app).get(
      "/api/surplus?merchantId=persona_steady_retainer&riskProfile=RECKLESS",
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for a negative obligation", async () => {
    const res = await request(app).get(
      "/api/surplus?merchantId=persona_steady_retainer&monthlyObligationsCents=-1",
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/plan", () => {
  it("returns summary, surplus and plan", async () => {
    const res = await request(app).post("/api/plan").send({
      merchantId: "persona_steady_retainer",
      monthlyObligationsCents: 300000,
      riskProfile: "BALANCED",
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.surplus.modelStatus).toBe("OK");
    expect(res.body.plan.bands).toHaveLength(3);
    expect(res.body.plan.disclaimerId).toBe("EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1");
  });

  it("returns 400 for a missing risk profile", async () => {
    const res = await request(app).post("/api/plan").send({
      merchantId: "persona_steady_retainer",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("returns 400 for a non-integer obligation", async () => {
    const res = await request(app).post("/api/plan").send({
      merchantId: "persona_steady_retainer",
      monthlyObligationsCents: 10.5,
      riskProfile: "BALANCED",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/scenario", () => {
  const valid = {
    merchantId: "persona_steady_retainer",
    monthlyObligationsCents: 300000,
    riskProfile: "BALANCED",
    incomeShockPct: -20,
    delayedPaymentCents: 100000,
    oneOffExpenseCents: 50000,
  };

  it("returns a comparison for a valid body", async () => {
    const res = await request(app).post("/api/scenario").send(valid);
    expect(res.status).toBe(200);
    expect(res.body.baselineSurplus).toBeDefined();
    expect(res.body.stressedSurplus).toBeDefined();
    expect(typeof res.body.deltaSafeSurplusCents).toBe("number");
  });

  it("returns 400 when incomeShockPct is out of range", async () => {
    const res = await request(app)
      .post("/api/scenario")
      .send({ ...valid, incomeShockPct: 200 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when monthlyObligationsCents is missing", async () => {
    const { monthlyObligationsCents: _omit, ...rest } = valid;
    const res = await request(app).post("/api/scenario").send(rest);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/transactions", () => {
  it("returns normalized transactions for a merchant", async () => {
    const res = await request(app).get("/api/transactions?merchantId=persona_steady_retainer");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(12);
    expect(res.body[0].merchantId).toBe("persona_steady_retainer");
  });

  it("returns 400 for a missing merchant", async () => {
    const res = await request(app).get("/api/transactions");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/advisor", () => {
  it("returns a contract-valid fallback with the disclaimer", async () => {
    const res = await request(app).post("/api/advisor").send({
      merchantId: "persona_steady_retainer",
      riskProfile: "BALANCED",
    });
    expect(res.status).toBe(200);
    expect(res.body.validatorStatus).toBe("FALLBACK_TEMPLATE");
    expect(res.body.disclaimerId).toBe("EDUCATIONAL_NOT_FINANCIAL_ADVICE_V1");
    expect(typeof res.body.disclaimerText).toBe("string");
  });

  it("returns 400 for an invalid body", async () => {
    const res = await request(app)
      .post("/api/advisor")
      .send({ merchantId: "persona_steady_retainer", riskProfile: "NOPE" });
    expect(res.status).toBe(400);
  });
});

describe("misc", () => {
  it("returns a safe 404 body", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await request(app)
      .post("/api/plan")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_json");
  });

  it("sets CORS only for the configured origin", async () => {
    const allowed = await request(app).get("/api/health").set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");

    const denied = await request(app).get("/api/health").set("Origin", "http://evil.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows the admin reset header in CORS preflight", async () => {
    const res = await request(app)
      .options("/api/admin/reset")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type, x-admin-reset-token");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-headers"]).toContain("x-admin-reset-token");
  });

  it("sends hardened headers and hides the server banner", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("live merchant with no events yet", () => {
  it("serves summary, surplus and plan without throwing", async () => {
    const emptyLive: MerchantDataset = {
      transactions: [],
      availableBalanceCents: 0,
      balanceSource: "LIVE_WEBHOOK_ADJUSTED",
      openDisputes: {
        count: 0,
        totalAmountCents: 0,
        unheldAmountCents: 0,
      },
      excludedNonUsdCount: 0,
    };
    const liveApp = buildApp({ loadDataset: () => emptyLive });

    const summary = await request(liveApp).get("/api/summary?merchantId=live_sandbox");
    expect(summary.status).toBe(200);

    const surplus = await request(liveApp).get("/api/surplus?merchantId=live_sandbox");
    expect(surplus.status).toBe(200);

    const plan = await request(liveApp).post("/api/plan").send({
      merchantId: "live_sandbox",
      monthlyObligationsCents: 0,
      riskProfile: "BALANCED",
    });
    expect(plan.status).toBe(200);
  });
});
