# Decisions and spike log

R6 owns this file. Every member appends their own section (do not rewrite other sections).
Format for each entry: date (Africa/Cairo), task id, author role, what was decided or found.

## Foundation decisions (K-2 scaffold)

- Internal packages (`@surplus/contracts`, `@surplus/engine`, `@surplus/paypal`) are consumed as TypeScript source via `exports: ./src/index.ts`. No build step between packages. `apps/api` runs with `tsx`; `apps/web` uses `transpilePackages`.
- `build` in every package except `apps/web` is a typecheck (`tsc --noEmit`). `pnpm -r build` therefore also runs `next build`.
- `DATABASE_PATH` is resolved relative to the repo root, never the current working directory.
- `apps/api/src/server.ts` is a framework-neutral `node:http` health stub. Express vs Fastify: PENDING (R1 decides in Sprint 0 and records it here).
- Lint rules encode the repo rules: no `any`, no `toFixed` outside `apps/web`, and `packages/engine` cannot read the clock, use randomness, or import I/O, DB or LLM modules.
- PR rules (branch name, title, file ownership) are checked by `.github/workflows/pr-checks.yml`. Cross-owner changes need the owner's approval and the `ownership-approved` label. Task K-2 (scaffold) is exempt from the ownership check.

## K-1 Devpost compliance checklist (R6)

_Pending._

## Gate 0 evidence (Oct 24, 21:00 Cairo)

### S-1 Transaction Search, Balances, Disputes (R1)

Script: `packages/paypal/src/spikes/s1_search.ts`.
**Status: code complete, awaiting live run** (credentials not yet in `.env`).

Free-text fields (`transaction_subject`, `transaction_note`, `custom_field`,
`payer_name`, `messages`) are stripped in the client layer (`types.ts` does not
include them) and again in R2's normalizer (defense in depth).

### S-2 Orders v2 capture and hybrid store (R2)

_Pending._

### S-4 Webhook signature verification (R1)

Script: `packages/paypal/src/spikes/s4_webhook.ts`.
**Status: code complete, awaiting live run** (ngrok tunnel + `PAYPAL_WEBHOOK_ID` needed).

Expected verification flow:

1. POST /webhook -> collect raw body (no prior parse).
2. Extract headers: `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`,
   `PAYPAL-CERT-URL`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-AUTH-ALGO`.
3. POST /v1/notifications/verify-webhook-signature with those headers,
   `PAYPAL_WEBHOOK_ID`, and the parsed event body.
4. `verification_status === "SUCCESS"` -> accept; anything else -> 400, zero DB write.

`verification_status: "SUCCESS"` will be recorded here once the live run completes.

### S-5 MCP read-only allowlist and sanitizer (R4)

_Pending._

## Engine decisions (R3)

All entries below are Oct 24–25, 2026 (Africa/Cairo), R3, tasks K-4 / F-6 / F-7 / F-8 / H-7. Contracts v1.0 (`packages/contracts`) is frozen for the demo path: changing any type/field there after Gate 0 requires a synchronous engine + advisor update (append an addendum here first).

**Calendar and windows (F-6).** All calendar math is UTC-only; "completed months" are UTC month buckets strictly before the month that contains `asOf`, and the in-progress month never enters the monthly model — its rows only move the available balance (append-only demo arithmetic). Window totals (week/month/year) are trailing half-open `[asOf − 7/30/365 days, asOf)`: boundaries inclusive at start, exclusive at `asOf`. The 90-day refund-rate window is anchored to the start of the current month (`[currentMonthStart − 90d, currentMonthStart)`), NOT to `asOf`, so a live payment during the in-progress month cannot distort the rate retroactively. The monthly series is the contiguous zero-filled span from the earliest to the latest month **with completed transactions** (inter-blank months are true zeros; a month with no data past that point cannot dilute the baseline with fabricated months).

**Aggregation rules.** `grossIncomeCents` = Σ `grossCents` of `kind=income`; `feesCents` = Σ `feeCents` of ALL completed rows (not only income); `refundsCents`/`chargebacksCents` = Σ `grossCents` by kind; `withdrawalsCents` is tracked but never subtracted from the monthly net: `netCents = grossIncome − fees − refunds − chargebacks`. `transactionCount` counts aggregated COMPLETED USD rows; PENDING/REVERSED rows and non-USD rows are excluded (contracts lock rows to USD anyway — the loader normalizes upstream).

**Volatility (cv, buffer).** cv = `round4(sampleStdDev / max(mean, baseline))` over the net series; M < 3 → cv exactly 0; mean ≤ 0 or baseline ≤ 0 → cv exactly 1 (guard, not error). `bufferMonths = round2(clamp(3 + 6×cv, 3, 9))`; `bufferTargetCents = round(bufferMonths × monthlyObligationsCents)`. cv > 1.0 is possible for tiny samples with outliers (std/mean of 3 points) — the 9-month clamp contains it; cv is asserted finite, in [0, ∞).

**Degraded gates (F-7), in fixed order:** M < 3 → `INSUFFICIENT_DATA` (cv 0, buffer 9.00, target round(9×obligations), safe 0) → obligations ≤ 0 → `OBLIGATIONS_REQUIRED` (stats normal, bufferTarget 0, safe 0) → mean ≤ 0 or baseline ≤ 0 → `NEGATIVE_CASH_FLOW` (cv 1, buffer 9, target round(9×obligations), safe 0). Every status still emits the canonical 10 breakdown lines and a per-profile staging schedule (zeros when safe = 0); `stagingTrancheCount` stays 6/4/3 per profile even in degraded states.

**Obligations resolution.** A supplied value wins (`USER_INPUT`). Otherwise `TRAILING_3M_WITHDRAWAL_AVG` = `round(Σ withdrawal grossCents across the last 3 series buckets ÷ 3)`; a zero default then triggers `OBLIGATIONS_REQUIRED` downstream instead of silently staging everything.

**Safe surplus.** `safe = max(0, available − bufferTarget − unheldOpenDisputes − expectedRefundExposure)` where `exposure = round(refundRate90d × max(baseline, 0))` and `riskReserve = unheld + exposure`. `refundRate90d = round4(min(1, (refunds+chargebacks in 90d window) / max(grossIncome in window, 1)))`, with the previous months' rate bounded in [0, 1].

**Staging (executeAfterDays rule).** Tranche count N = 6 (CONSERVATIVE) / 4 (BALANCED) / 3 (GROWTH). `base = floor(safe / N)` per tranche, remainder `safe − base×N` added to tranche 1 only (exact integer sum, tranche 1 ≥ the others). `executeAfterDays = (trancheNumber − 1) × 30` (monthly ladder, first tranche immediate).

**Bands and the CV shift (F-8).** Base midpoints: CONSERVATIVE 50/35/15, BALANCED 30/30/40, GROWTH 15/20/65 (cash/bonds/equity). The shift applies when cv is **strictly greater** than 0.60 (cv = 0.6000 → no shift; 0.6001 → shift): cash min/max/target each +10 pts, equity target −10 (clamped at ≥ 0), bonds untouched; reasonCode `HIGH_VOLATILITY_CV_SHIFT` on cash and equity only, base codes elsewhere. Cents: bonds and equity get `round(pct × safe)`; CASH_MMF absorbs the remainder (`safe − bonds − equity`) — it is the mathematically chosen remainder-bearer because its exact float product can under-represent it; proved exact sum and cash ≥ 0.

**Scenarios (F-8).** `incomeShockPct` scales ONLY `kind=income`, `status=COMPLETED` rows, with per-row `round(k × gross)` and `round(k × fee)` and net recomputed (`k = 1 + shock/100`); refunds, chargebacks, withdrawals and the dispute set are untouched. `stressedAvailable = max(0, available − delayedPayment − oneOffExpense)`. The stressed case re-runs the FULL chain (cv, buffer, rate, reserve, staging, bands) at the same `asOf`; consistency: merchantId and riskProfile must equal the base's, and if the base supplies obligations, the scenario's must match. Deltas: `round2(stressed − baseline)` for both safe and buffer.

**Rounding conventions.** All money is non-negative integer cents; `round4` for ratios, `round2` for `bufferMonths`/`trendSlopeCentsPerMonth`. Math.round ties toward +infinity at the final round (−0.375 → −0.37 tie behavior is irrelevant because money inputs are non-negative); −0 is normalized to plain 0 so serialized JSON never contains "-0". Even-sample medians average the middle pair and round to integer cents (contract locks `SafeInt`).

**Purity contract (lint-enforced).** `packages/engine` is forbidden `Date.now()`, zero-arg `new Date()`, `Math.random`, pseudorandom import, and any I/O/DB/LLM import. Every Date is derived from caller-passed ISO strings; the same input always produces deep-identical outputs (property-tested).

**Cross-check lock (H-7).** `packages/contracts/src/examples.ts` freezes the Section-12 demo payloads; `packages/engine/src/golden.test.ts` rebuilds the exact demo dataset and asserts `computeCashFlowSummary`/`computeSurplus`/`computeAllocationPlan`/`runScenarioComparison` outputs deep-equal those payloads. Engine drift without re-freezing the examples fails CI — the two-way lock between contracts and engine. Persona snapshots (steady/volatile/seasonal/dispute) plus 1000+ fast-check runs cover profile × gate × schedule invariants; engine line coverage ≥ 99%.

## Open questions

_None yet._
- 2026-10-25T19:55:00+02:00 | K-3 | R1 | Merged sandbox oauth test:token script from origin/r1/k-3-sandbox-setup. All 6 members can run pnpm --filter @surplus/paypal test:token once creds in env.

## R1 (Tech Lead - PayPal infrastructure, API, deployment)

### 2026-10-25 F-9 API routes (R1)

- Framework: **Express 4** for pps/api (rationale already recorded under F-1: raw-body handling for the webhook route).
- Route set: GET /api/health, GET /api/summary, GET /api/surplus, POST /api/plan, POST /api/scenario, GET /api/transactions, POST /api/advisor.
- Money never leaves @surplus/contracts/@surplus/engine: routes pass integer cents through untouched and contain zero arithmetic.
- Request wrappers (pps/api/src/routes/schemas.ts) re-use contracts enums only. **Request to R3:** consider absorbing MerchantQuerySchema, SurplusQuerySchema, PlanRequestSchema, ScenarioRequestSchema into contracts.
- **asOf anchor (request to R2 and R3 to confirm):** fixture personas use DEMO_AS_OF = 2026-10-01T00:00:00Z for reproducible golden values; live_sandbox uses 
ew Date().toISOString(). Implemented in pps/api/src/routes/dataset.ts.
- **Temporary stubs:** (1) pps/api/src/routes/dataset.ts returns the contracts example payload until R2 exposes getMerchantDataset(merchantId) in packages/paypal/src/sources; the loader is injected through uildApp(), so the swap is one line. (2) POST /api/advisor returns a FALLBACK_TEMPLATE AdvisorResponse until R4's unAdvisorTurn lands (injectable the same way). Both are marked TEMPORARY in code.
- Tests: 20 supertest cases (200 valid / 400 invalid per route, 404, malformed JSON, CORS restriction). pnpm -r build and pnpm -r test green.

### Requests to other owners

- **R2:** export MerchantDataset + getMerchantDataset(merchantId) from packages/paypal/src/sources (shape used: transactions, availableBalanceCents, balanceSource, openDisputes, excludedNonUsdCount).
- **R3:** confirm the fixture sOf anchor; optionally adopt the request schemas into @surplus/contracts.
- **R4:** export unAdvisorTurn from pps/api/src/agent with the injectable shape used here.
