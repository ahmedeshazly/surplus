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

_Pending._

### S-2 Orders v2 capture and hybrid store (R2)

_Pending._

### S-4 Webhook signature verification (R1)

_Pending._

### S-5 MCP read-only allowlist and sanitizer (R4)

_Pending._

## Engine decisions (R3)

All entries below are Oct 24â€“25, 2026 (Africa/Cairo), R3, tasks K-4 / F-6 / F-7 / F-8 / H-7. Contracts v1.0 (`packages/contracts`) is frozen for the demo path: changing any type/field there after Gate 0 requires a synchronous engine + advisor update (append an addendum here first).

**Calendar and windows (F-6).** All calendar math is UTC-only; "completed months" are UTC month buckets strictly before the month that contains `asOf`, and the in-progress month never enters the monthly model â€” its rows only move the available balance (append-only demo arithmetic). Window totals (week/month/year) are trailing half-open `[asOf âˆ’ 7/30/365 days, asOf)`: boundaries inclusive at start, exclusive at `asOf`. The 90-day refund-rate window is anchored to the start of the current month (`[currentMonthStart âˆ’ 90d, currentMonthStart)`), NOT to `asOf`, so a live payment during the in-progress month cannot distort the rate retroactively. The monthly series is the contiguous zero-filled span from the earliest to the latest month **with completed transactions** (inter-blank months are true zeros; a month with no data past that point cannot dilute the baseline with fabricated months).

**Aggregation rules.** `grossIncomeCents` = Î£ `grossCents` of `kind=income`; `feesCents` = Î£ `feeCents` of ALL completed rows (not only income); `refundsCents`/`chargebacksCents` = Î£ `grossCents` by kind; `withdrawalsCents` is tracked but never subtracted from the monthly net: `netCents = grossIncome âˆ’ fees âˆ’ refunds âˆ’ chargebacks`. `transactionCount` counts aggregated COMPLETED USD rows; PENDING/REVERSED rows and non-USD rows are excluded (contracts lock rows to USD anyway â€” the loader normalizes upstream).

**Volatility (cv, buffer).** cv = `round4(sampleStdDev / max(mean, baseline))` over the net series; M < 3 â†’ cv exactly 0; mean â‰¤ 0 or baseline â‰¤ 0 â†’ cv exactly 1 (guard, not error). `bufferMonths = round2(clamp(3 + 6Ã—cv, 3, 9))`; `bufferTargetCents = round(bufferMonths Ã— monthlyObligationsCents)`. cv > 1.0 is possible for tiny samples with outliers (std/mean of 3 points) â€” the 9-month clamp contains it; cv is asserted finite, in [0, âˆž).

**Degraded gates (F-7), in fixed order:** M < 3 â†’ `INSUFFICIENT_DATA` (cv 0, buffer 9.00, target round(9Ã—obligations), safe 0) â†’ obligations â‰¤ 0 â†’ `OBLIGATIONS_REQUIRED` (stats normal, bufferTarget 0, safe 0) â†’ mean â‰¤ 0 or baseline â‰¤ 0 â†’ `NEGATIVE_CASH_FLOW` (cv 1, buffer 9, target round(9Ã—obligations), safe 0). Every status still emits the canonical 10 breakdown lines and a per-profile staging schedule (zeros when safe = 0); `stagingTrancheCount` stays 6/4/3 per profile even in degraded states.

**Obligations resolution.** A supplied value wins (`USER_INPUT`). Otherwise `TRAILING_3M_WITHDRAWAL_AVG` = `round(Î£ withdrawal grossCents across the last 3 series buckets Ã· 3)`; a zero default then triggers `OBLIGATIONS_REQUIRED` downstream instead of silently staging everything.

**Safe surplus.** `safe = max(0, available âˆ’ bufferTarget âˆ’ unheldOpenDisputes âˆ’ expectedRefundExposure)` where `exposure = round(refundRate90d Ã— max(baseline, 0))` and `riskReserve = unheld + exposure`. `refundRate90d = round4(min(1, (refunds+chargebacks in 90d window) / max(grossIncome in window, 1)))`, with the previous months' rate bounded in [0, 1].

**Staging (executeAfterDays rule).** Tranche count N = 6 (CONSERVATIVE) / 4 (BALANCED) / 3 (GROWTH). `base = floor(safe / N)` per tranche, remainder `safe âˆ’ baseÃ—N` added to tranche 1 only (exact integer sum, tranche 1 â‰¥ the others). `executeAfterDays = (trancheNumber âˆ’ 1) Ã— 30` (monthly ladder, first tranche immediate).

**Bands and the CV shift (F-8).** Base midpoints: CONSERVATIVE 50/35/15, BALANCED 30/30/40, GROWTH 15/20/65 (cash/bonds/equity). The shift applies when cv is **strictly greater** than 0.60 (cv = 0.6000 â†’ no shift; 0.6001 â†’ shift): cash min/max/target each +10 pts, equity target âˆ’10 (clamped at â‰¥ 0), bonds untouched; reasonCode `HIGH_VOLATILITY_CV_SHIFT` on cash and equity only, base codes elsewhere. Cents: bonds and equity get `round(pct Ã— safe)`; CASH_MMF absorbs the remainder (`safe âˆ’ bonds âˆ’ equity`) â€” it is the mathematically chosen remainder-bearer because its exact float product can under-represent it; proved exact sum and cash â‰¥ 0.

**Scenarios (F-8).** `incomeShockPct` scales ONLY `kind=income`, `status=COMPLETED` rows, with per-row `round(k Ã— gross)` and `round(k Ã— fee)` and net recomputed (`k = 1 + shock/100`); refunds, chargebacks, withdrawals and the dispute set are untouched. `stressedAvailable = max(0, available âˆ’ delayedPayment âˆ’ oneOffExpense)`. The stressed case re-runs the FULL chain (cv, buffer, rate, reserve, staging, bands) at the same `asOf`; consistency: merchantId and riskProfile must equal the base's, and if the base supplies obligations, the scenario's must match. Deltas: `round2(stressed âˆ’ baseline)` for both safe and buffer.

**Rounding conventions.** All money is non-negative integer cents; `round4` for ratios, `round2` for `bufferMonths`/`trendSlopeCentsPerMonth`. Math.round ties toward +infinity at the final round (âˆ’0.375 â†’ âˆ’0.37 tie behavior is irrelevant because money inputs are non-negative); âˆ’0 is normalized to plain 0 so serialized JSON never contains "-0". Even-sample medians average the middle pair and round to integer cents (contract locks `SafeInt`).

**Purity contract (lint-enforced).** `packages/engine` is forbidden `Date.now()`, zero-arg `new Date()`, `Math.random`, pseudorandom import, and any I/O/DB/LLM import. Every Date is derived from caller-passed ISO strings; the same input always produces deep-identical outputs (property-tested).

**Cross-check lock (H-7).** `packages/contracts/src/examples.ts` freezes the Section-12 demo payloads; `packages/engine/src/golden.test.ts` rebuilds the exact demo dataset and asserts `computeCashFlowSummary`/`computeSurplus`/`computeAllocationPlan`/`runScenarioComparison` outputs deep-equal those payloads. Engine drift without re-freezing the examples fails CI â€” the two-way lock between contracts and engine. Persona snapshots (steady/volatile/seasonal/dispute) plus 1000+ fast-check runs cover profile Ã— gate Ã— schedule invariants; engine line coverage â‰¥ 99%.

## Open questions

_None yet._

## R1 (Tech Lead - PayPal infrastructure, API, deployment)

### 2026-10-25 F-9 API routes (R1)

- Framework: **Express 4** for `apps/api` (rationale recorded under F-1: raw-body handling for the webhook route).
- Route set: `GET /api/health`, `GET /api/summary`, `GET /api/surplus`, `POST /api/plan`, `POST /api/scenario`, `GET /api/transactions`, `POST /api/advisor`.
- Money never leaves `@surplus/contracts`/`@surplus/engine`: routes pass integer cents through untouched and contain zero arithmetic.
- Request wrappers (`apps/api/src/routes/schemas.ts`) re-use contracts enums only. **Request to R3:** consider absorbing `MerchantQuerySchema`, `SurplusQuerySchema`, `PlanRequestSchema`, `ScenarioRequestSchema` into contracts.
- **asOf anchor (request to R2 and R3 to confirm):** fixture personas use `DEMO_AS_OF = 2026-10-01T00:00:00Z` for reproducible golden values; `live_sandbox` uses the current time. Implemented in `apps/api/src/routes/dataset.ts`.
- **Temporary stubs:** (1) `apps/api/src/routes/dataset.ts` returns the contracts example payload until R2 exposes `getMerchantDataset(merchantId)` in `packages/paypal/src/sources`; the loader is injected through `buildApp()`, so the swap is one line. (2) `POST /api/advisor` returns a `FALLBACK_TEMPLATE` `AdvisorResponse` until R4's `runAdvisorTurn` lands (injectable the same way). Both are marked TEMPORARY in code.
- Tests: 20 supertest cases (200 valid / 400 invalid per route, 404, malformed JSON, CORS restriction). `pnpm -r build` and `pnpm -r test` green.

### Requests to other owners

- **R2:** export `MerchantDataset` + `getMerchantDataset(merchantId)` from `packages/paypal/src/sources`.
- **R3:** confirm the fixture asOf anchor; optionally adopt the request schemas into `@surplus/contracts`.
- **R4:** export `runAdvisorTurn` from `apps/api/src/agent` with the injectable shape used here.

---

### R1 decisions and spike log (K-3, S-1, S-4, F-1, C-12, H-2 draft)
### 2026-10-25 K-3 â€“ Sandbox token check (R1)

Script: `packages/paypal/src/scripts/testToken.ts`.
Prints OK/FAIL and expiry seconds only; never the token value.
Awaiting human action: PayPal REST app creation and credential placement in `.env`.

### 2026-10-25 S-1 â€“ Transaction Search, Balances, Disputes spike (R1)

Script: `packages/paypal/src/spikes/s1_search.ts`.
**Status: code complete, awaiting live run** (credentials not yet in `.env`).

Expected response shapes (from PayPal API docs and K-2 research):

**GET /v1/reporting/transactions:**
```
{
  transaction_details: [
    {
      transaction_info: {
        transaction_id: string,
        transaction_event_code: string,   // e.g. "T0006"
        transaction_initiation_date: string,  // RFC3339
        transaction_amount: { currency_code: string, value: string },
        fee_amount: { currency_code: string, value: string } | undefined,
        transaction_status: string,
        // FREE TEXT â€“ stripped: transaction_subject, transaction_note, custom_field
      },
      payer_info: {
        account_id: string,
        email_address: string,   // PII â€“ normalizer hashes this
        // FREE TEXT â€“ stripped: payer_name.given_name, payer_name.surname
      },
      cart_info: { item_details: [...] }  // item_name is FREE TEXT â€“ stripped
    }
  ],
  page: number,
  total_items: number,
  total_pages: number,
  start_date: string,
  end_date: string
}
```

**GET /v1/reporting/balances:**
```
{
  balances: [
    {
      currency: string,
      primary: boolean,
      available_balance: { currency_code: string, value: string },
      withheld_balance: { currency_code: string, value: string } | undefined,
      total_balance: { currency_code: string, value: string }
    }
  ],
  as_of_time: string
}
```

**GET /v1/customer/disputes:**
```
{
  items: [
    {
      dispute_id: string,
      create_time: string,
      status: string,   // e.g. "UNDER_REVIEW", "OPEN_INQUIRIES", "REQUIRED_ACTION"
      dispute_amount: { currency_code: string, value: string },
      reason: string,
      // FREE TEXT stripped: messages, dispute_note, buyer_response_due_date
    }
  ],
  links: [{ href: string, rel: string, method: string }]
}
```

Decision: free text fields (`transaction_subject`, `transaction_note`, `custom_field`,
`payer_name`, `messages`) are stripped in the client layer (types.ts does not include
them) and again in R2's normalizer (defense in depth).

### 2026-10-25 S-4 â€“ Webhook spike (R1)

Script: `packages/paypal/src/spikes/s4_webhook.ts`.
**Status: code complete, awaiting live run** (ngrok tunnel + PAYPAL_WEBHOOK_ID needed).

Expected verification flow:
1. POST /webhook â†’ collect raw body (no prior parse).
2. Extract headers: PAYPAL-TRANSMISSION-ID, PAYPAL-TRANSMISSION-TIME,
   PAYPAL-CERT-URL, PAYPAL-TRANSMISSION-SIG, PAYPAL-AUTH-ALGO.
3. POST /v1/notifications/verify-webhook-signature with those headers +
   webhook_id (PAYPAL_WEBHOOK_ID) + parsed event body.
4. verification_status === "SUCCESS" â†’ accept; anything else â†’ 400, zero DB write.

`verification_status: "SUCCESS"` will be recorded here once the live run completes.

### 2026-10-25 F-1 â€“ PaypalClient decisions (R1)

**Framework choice:** Pure Node 20 built-in `fetch` + `node:crypto`. No extra HTTP
libraries. Reason: project rules prefer built-ins; Node 20 fetch is production-stable.

**Express vs Fastify:** Choosing **Express** for `apps/api`. Reason: simpler raw-body
middleware story (`express.raw()`) which is critical for the webhook route that must
read the exact bytes before any parsing. Fastify's `addContentTypeParser` achieves
the same but with more ceremony; the Express approach is more readable for the team.
Recorded here as the official framework choice.

**Token cache:** Single in-flight refresh using a pending-promise guard. After a 401
the cache is invalidated and a single retry occurs; repeated 401s surface as
`PayPalError("OAUTH_FAILED")`.

**31-day window guard:** `searchTransactions` throws `PayPalError("WINDOW_TOO_LARGE")`
if `endDate - startDate > 31 days`. R2's windowed loader calls this in 31-day chunks.

**Backoff:** Full-jitter exponential, base 500ms, cap 30s, 5 attempts by default.
Retryable: network errors, 429, 5xx. Not retryable: other 4xx.

**Free text defense:** The typed interface in `types.ts` does NOT declare
`transaction_subject`, `transaction_note`, `custom_field`, `payer_name`, or `messages`.
Fields that are not declared are silently dropped during JSON deserialization.
R2's normalizer applies a second strip as defense in depth.

**Dispute fields returned:** `disputeId`, `status`, `disputeAmount` (currency + value),
`createTime` only. All other fields including `messages`, `dispute_note` are absent.

### 2026-10-25 F-9 â€“ API routes decisions (R1)

Framework: **Express** (see F-1 decision above).

**asOf anchoring:**
- Fixture personas (`persona_*`): anchor `asOf` to `"2026-10-24T21:00:00Z"` (Gate 0
  timestamp). This makes golden test values reproducible regardless of when the server
  runs. Decision flagged for R2 and R3 to confirm; recorded under "Requests to other
  owners" in the F-9 PR.
- `live_sandbox`: use `new Date().toISOString()` (current time).

**Requests to other owners:**
- R2: confirm `getMerchantDataset(merchantId)` signature and return type
  `{ transactions, availableBalanceCents, balanceSource, openDisputes, excludedNonUsdCount }`.
  Routes currently code against a stub in `apps/api/src/routes/stubs.ts`.
- R3: confirm `computeCashFlowSummary`, `computeSurplus`, `computeAllocationPlan`,
  `runScenarioComparison` function signatures and that they accept `asOf: string`.
  Routes code against a stub until R3's package merges.
- R3: confirm that the local thin Zod wrappers for query params
  (`merchantIdSchema`, `scenarioInputSchema`) do not need to live in `@surplus/contracts`.

### 2026-10-25 C-5 â€“ Webhooks + SSE decisions (R1)

**SQLite persistence on Render (C-12):** Default strategy is reseed on every boot
(no Render persistent disk, which costs $7/month). On restart, `webhook_events` rows
from live payments are lost. The live demo survives because judges do a fresh payment
after each demo. If needed for the video, R1 can add the `persistentDisk` section to
`render.yaml` (a human-only paid action, listed in the checklist).

### 2026-10-25 H-2 â€“ Security audit notes (R1, to be completed Nov 5â€“9)

Findings to audit: secrets in git history (gitleaks), CORS origin lockdown,
admin reset endpoint constant-time compare, webhook signature verification before
any DB write, Zod validation on all routes, log hygiene (no tokens, no free text,
no payer PII in any log line).

