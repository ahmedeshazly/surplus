// Owner: R1. Task F-9: Express application factory for the Surplus API.
//
// Routes validate input, load a merchant dataset, then call pure engine
// functions. No money math lives here: every cents value comes from
// @surplus/engine or is passed through untouched.
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import type {
  AdvisorResponse,
  MerchantId,
  NormalizedTransaction,
  ScenarioInput,
} from "@surplus/contracts";
import { DISCLAIMER_ID_V1, DISCLAIMER_TEXT_V1 } from "@surplus/contracts";
import {
  computeAllocationPlan,
  computeCashFlowSummary,
  computeSurplus,
  runScenarioComparison,
} from "@surplus/engine";
import type { DatasetLoader, MerchantDataset } from "./routes/dataset";
import { asOfFor, exampleDatasetLoader } from "./routes/dataset";
import {
  MerchantQuerySchema,
  PlanRequestSchema,
  ScenarioRequestSchema,
  SurplusQuerySchema,
} from "./routes/schemas";
import { SseHub } from "./routes/sseHub";
import type { WebhookDeps } from "./routes/webhooks";
import { createWebhookHandler } from "./routes/webhooks";
import { createAdminResetHandler } from "./routes/admin";

export interface BuildAppOptions {
  /** R2's getMerchantDataset(merchantId) once it lands on main. */
  loadDataset?: DatasetLoader;
  /** R4's runAdvisorTurn() once C-2 lands on main. */
  runAdvisorTurn?: (input: {
    merchantId: MerchantId;
    dataset: MerchantDataset;
    asOf: string;
  }) => Promise<AdvisorResponse>;
  /** SSE hub shared by the events route and the webhook controller. */
  sseHub?: SseHub;
  /** Webhook verification + persistence. Omitted in F-9-only deployments. */
  webhook?: Pick<WebhookDeps, "verify" | "store" | "now">;
  /** Enables POST /api/admin/reset when a non-empty token is supplied. */
  admin?: { token: string; reset: () => void | Promise<void> };
  webOrigin?: string;
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function handle(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

function sendInvalid(res: Response, error: ZodError): void {
  res.status(400).json({
    error: "invalid_request",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    })),
  });
}

function buildCors(webOrigin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (origin !== undefined && origin === webOrigin) {
      res.setHeader("Access-Control-Allow-Origin", webOrigin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

/**
 * TEMPORARY advisor stub until R4's C-2 merges. Returns a contract-valid
 * AdvisorResponse with the mandatory disclaimer so the route shape is stable.
 */
function advisorStub(merchantId: MerchantId): AdvisorResponse {
  return {
    merchantId,
    narrativeMarkdown:
      "The advisor is not wired up yet. This placeholder keeps the API contract stable while R4 finishes the grounded agent.",
    citedNumbers: [],
    toolTrace: [],
    validatorStatus: "FALLBACK_TEMPLATE",
    validatorMismatchesCaught: [],
    disclaimerId: DISCLAIMER_ID_V1,
    disclaimerText: DISCLAIMER_TEXT_V1,
    generatedAt: new Date().toISOString(),
  };
}

/** Returns the Express app without listening, so tests can drive it with supertest. */
export function buildApp(options: BuildAppOptions = {}): express.Express {
  const loadDataset = options.loadDataset ?? exampleDatasetLoader;
  const webOrigin = options.webOrigin ?? process.env["WEB_ORIGIN"] ?? "http://localhost:3000";
  const sseHub = options.sseHub ?? new SseHub();
  const app = express();

  app.disable("x-powered-by");
  app.use(buildCors(webOrigin));

  // Webhooks must see the untouched bytes, so they are mounted before JSON parsing.
  if (options.webhook !== undefined) {
    const webhookHandler = createWebhookHandler({
      verify: options.webhook.verify,
      store: options.webhook.store,
      hub: sseHub,
      now: options.webhook.now,
    });
    app.post(
      "/api/webhooks/paypal",
      express.raw({ type: () => true, limit: "1mb" }),
      handle(webhookHandler),
    );
  }

  app.use(express.json({ limit: "100kb" }));

  app.get("/api/events", (req, res) => {
    const parsed = MerchantQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const merchantId = parsed.data.merchantId;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const unsubscribe = sseHub.subscribe({
      merchantId,
      send: (chunk) => res.write(chunk),
      end: () => res.end(),
    });
    req.on("close", unsubscribe);
  });

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ ok: true, service: "surplus-api" });
  });

  if (options.admin !== undefined && options.admin.token.length > 0) {
    const adminReset = createAdminResetHandler(options.admin);
    app.post("/api/admin/reset", handle(adminReset));
  }

  app.get(
    "/api/summary",
    handle(async (req, res) => {
      const { merchantId } = MerchantQuerySchema.parse(req.query);
      const dataset = await loadDataset(merchantId);
      const asOf = asOfFor(merchantId);
      const summary = computeCashFlowSummary({
        merchantId,
        transactions: dataset.transactions,
        asOf,
        openDisputes: dataset.openDisputes,
        excludedNonUsdCount: dataset.excludedNonUsdCount,
      });
      res.status(200).json(summary);
    }),
  );

  app.get(
    "/api/surplus",
    handle(async (req, res) => {
      const query = SurplusQuerySchema.parse(req.query);
      const dataset = await loadDataset(query.merchantId);
      const asOf = asOfFor(query.merchantId);
      const surplus = computeSurplus({
        merchantId: query.merchantId,
        transactions: dataset.transactions,
        asOf,
        availableBalanceCents: dataset.availableBalanceCents,
        balanceSource: dataset.balanceSource,
        monthlyObligationsCents: query.monthlyObligationsCents,
        riskProfile: query.riskProfile,
        openDisputes: dataset.openDisputes,
        excludedNonUsdCount: dataset.excludedNonUsdCount,
      });
      res.status(200).json(surplus);
    }),
  );

  app.post(
    "/api/plan",
    handle(async (req, res) => {
      const body = PlanRequestSchema.parse(req.body);
      const dataset = await loadDataset(body.merchantId);
      const asOf = asOfFor(body.merchantId);
      const summary = computeCashFlowSummary({
        merchantId: body.merchantId,
        transactions: dataset.transactions,
        asOf,
        openDisputes: dataset.openDisputes,
        excludedNonUsdCount: dataset.excludedNonUsdCount,
      });
      const surplus = computeSurplus({
        merchantId: body.merchantId,
        transactions: dataset.transactions,
        asOf,
        availableBalanceCents: dataset.availableBalanceCents,
        balanceSource: dataset.balanceSource,
        monthlyObligationsCents: body.monthlyObligationsCents,
        riskProfile: body.riskProfile,
        openDisputes: dataset.openDisputes,
        excludedNonUsdCount: dataset.excludedNonUsdCount,
      });
      const plan = computeAllocationPlan(surplus);
      res.status(200).json({ summary, surplus, plan });
    }),
  );

  app.post(
    "/api/scenario",
    handle(async (req, res) => {
      const body = ScenarioRequestSchema.parse(req.body);
      const dataset = await loadDataset(body.merchantId);
      const asOf = asOfFor(body.merchantId);
      const scenario: ScenarioInput = {
        merchantId: body.merchantId,
        monthlyObligationsCents: body.monthlyObligationsCents,
        riskProfile: body.riskProfile,
        incomeShockPct: body.incomeShockPct,
        delayedPaymentCents: body.delayedPaymentCents,
        oneOffExpenseCents: body.oneOffExpenseCents,
      };
      const result = runScenarioComparison(
        {
          merchantId: body.merchantId,
          transactions: dataset.transactions,
          asOf,
          availableBalanceCents: dataset.availableBalanceCents,
          balanceSource: dataset.balanceSource,
          monthlyObligationsCents: body.monthlyObligationsCents,
          riskProfile: body.riskProfile,
          openDisputes: dataset.openDisputes,
          excludedNonUsdCount: dataset.excludedNonUsdCount,
        },
        scenario,
      );
      res.status(200).json(result);
    }),
  );

  app.get(
    "/api/transactions",
    handle(async (req, res) => {
      const { merchantId } = MerchantQuerySchema.parse(req.query);
      const dataset = await loadDataset(merchantId);
      const transactions: NormalizedTransaction[] = dataset.transactions.filter(
        (tx) => tx.merchantId === merchantId,
      );
      res.status(200).json(transactions);
    }),
  );

  app.post(
    "/api/advisor",
    handle(async (req, res) => {
      const body = PlanRequestSchema.parse(req.body);
      const dataset = await loadDataset(body.merchantId);
      const asOf = asOfFor(body.merchantId);
      const response = options.runAdvisorTurn
        ? await options.runAdvisorTurn({
            merchantId: body.merchantId,
            dataset,
            asOf,
          })
        : advisorStub(body.merchantId);
      res.status(200).json(response);
    }),
  );

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      sendInvalid(res, err);
      return;
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "type" in err &&
      (err as { type?: unknown }).type === "entity.too.large"
    ) {
      res.status(413).json({ error: "payload_too_large" });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    // Never leak stack traces or internal messages.
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
