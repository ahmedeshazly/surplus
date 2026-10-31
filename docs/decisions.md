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

- 2026-10-25T20:00:00+02:00 | STARTUP | R1 | On main. K-2 merged. Next: merge/complete K-3, S-1, S-4, F-1 from origin branches as they exist, then proceed to F-9 onward per task order.

## 2026-10-29 | S-5 | R4 | MCP trust boundary and package inspection

- Working branch: `r4/s-5-mcp-spike`, based on the locally available `origin/main`
  (`eace5d4`). Fetching is blocked by local GitHub authentication; refresh and
  rebase before opening the PR.
- Inspected the published `@paypal/mcp` 1.8.1 entry point. CLI selectors are
  `transactions.list` and `disputes.list`, producing `list_transactions` and
  `list_disputes`. The CLI does not accept a merchant-insights selector. Do not
  enable `--tools=all` to work around this; coordinate the missing capability with
  R1. `get_merchant_insights` remains an allowed name if an approved server offers it.
- Added a second client-side read-only allowlist, fixed tool descriptions, and a
  sanitizer that projects page counts only. It drops every raw record and string,
  including PayPal names, notes, memos, messages, IDs, links and amount strings.
  Unknown numeric fields are also dropped. Engine tools remain the monetary source
  of truth. Example synthetic output: `{ "recordsOnPage": 1, "totalItems": 15,
"totalPages": 3 }` (test data, not observed Sandbox data).
- Required dependencies are `ai` 4.3.19 (team-locked major), `@paypal/mcp` 1.8.1,
  and Zod 3.25.76 (compatible with AI SDK v4). Only the shared API package manifest
  and lockfile are changed outside the R4 source directory and this shared log.
- Live Sandbox verification is pending: no local `PAYPAL_ACCESS_TOKEN`, client
  credentials or AI keys were configured at inspection. Run
  `pnpm --filter @surplus/api spike:mcp` once R1 provides a local Sandbox token,
  then append the observed tool names and sanitized output here. No credentials
  or raw MCP responses should be recorded.
- F-11/C-2 integration is dependent on R3's contracts and engine merging. On this
  branch's base, both packages still export placeholders. Do not duplicate their
  shared types or modify their implementation in R4.
- Local verification: 22 tests pass, including discovery against the installed
  PayPal MCP subprocess (no PayPal API invoked), an offline stdio fixture, and
  mock-model tool calls through AI SDK v4. Observed local tools are
  `list_transactions` and `list_disputes`; `get_merchant_insights` is absent.
  Workspace tests and typechecks, root lint and formatting checks pass. Local
  runtime is Node 24.11.1 with pnpm 9.15.9; CI's Node 20 runtime remains to be
  verified. The live spike exits with code 1 and a constant safe message when a
  token is absent. These checks do not complete live S-5 acceptance.
- Full `pnpm -r build` is blocked locally at `apps/web`: `next: command not found`.
  Installing the remaining frontend packages stalled twice (16 of 18 cached),
  including a retry with lower concurrency and a fetch timeout, and was stopped.
  The API dependencies are installed and the API typecheck passed. Restore the
  complete workspace installation and rerun the full build before claiming CI
  readiness. No frontend source or configuration was changed.

### Local credential readiness follow-up (2026-10-29, R4)

- The root `.env` now exists and is ignored by Git; its file permissions are
  restricted to the local user. `.env.example` matches its original tracked
  content. No credential values are recorded here.
- The configured Gemini key successfully authenticated a GET request for
  `gemini-2.5-flash` model metadata (HTTP 200). No text-generation request was
  made; this confirms authentication, not inference quota or advisor behavior.
- PayPal client credentials remain equal to the template placeholders and no
  local `PAYPAL_ACCESS_TOKEN` is configured. Live S-5 verification still needs R1.
- Fetching `origin` still fails on GitHub authentication. No remote branches were
  changed and no code has been pushed.
- The remaining frontend dependencies were installed successfully using the
  frozen lockfile with pnpm 9.15.9 and copy-based package import. Full
  `pnpm -r build` now passes, including the Next.js production build and API
  typecheck; the earlier missing-Next.js blocker is resolved. The 22 R4 tests,
  API typecheck, and R4 lint/format checks also pass. The local Gemini key was not
  found in any tracked or non-ignored project file.

### PayPal AI Toolkit follow-up (2026-10-29, R4)

- Installed and enabled the official `paypal@paypal-ai-toolkit` Codex plugin,
  version 1.2.0, from `paypal/AI-Toolkit`. Codex must be restarted before its
  skills and `paypal-sandbox` MCP connection appear in a new session.
- Replaced the limited local `@paypal/mcp` subprocess with PayPal AI Toolkit's
  official Sandbox SSE endpoint, `https://mcp.sandbox.paypal.com/sse`. This is the
  server documented to provide reporting and merchant insights. The application
  still exposes only the three approved read-only names and sanitizes all results.
- Live discovery remains pending until R1 provides a valid Sandbox token through
  `PAYPAL_SANDBOX_ACCESS_TOKEN`. Tool availability will be recorded only after an
  authenticated connection; the fixture is not treated as live evidence.

### S-5 live Sandbox evidence (2026-10-29, R4)

- Exchanged the locally configured Sandbox client credentials through PayPal OAuth
  and stored the temporary access token only in the ignored `.env` with mode 0600.
  No credential, token, or raw response was printed or committed.
- Connected successfully to `https://mcp.sandbox.paypal.com/sse`. The authenticated
  server exposed all three approved read-only tools: `list_transactions`,
  `list_disputes`, and `get_merchant_insights`; no approved tool was unavailable.
- Invoked `list_disputes` successfully. The Sandbox account returned no count fields,
  so the sanitizer emitted `{}` and forwarded no raw records or strings. This is
  live connection and allowlist evidence; populated-record sanitization remains
  covered by the adversarial fixture tests.
## R1 (Tech Lead - PayPal infrastructure, API, deployment)

### 2026-10-25 F-9 API routes (R1)

- Framework: **Express 4** for apps/api (rationale already recorded under F-1: raw-body handling for the webhook route).
- Route set: GET /api/health, GET /api/summary, GET /api/surplus, POST /api/plan, POST /api/scenario, GET /api/transactions, POST /api/advisor.
- Money never leaves @surplus/contracts/@surplus/engine: routes pass integer cents through untouched and contain zero arithmetic.
- Request wrappers (apps/api/src/routes/schemas.ts) re-use contracts enums only. **Request to R3:** consider absorbing MerchantQuerySchema, SurplusQuerySchema, PlanRequestSchema, ScenarioRequestSchema into contracts.
- **asOf anchor (request to R2 and R3 to confirm):** fixture personas use DEMO_AS_OF = 2026-10-01T00:00:00Z for reproducible golden values; live_sandbox uses 
new Date().toISOString(). Implemented in apps/api/src/routes/dataset.ts.
- **Temporary stubs:** (1) apps/api/src/routes/dataset.ts returns the contracts example payload until R2 exposes getMerchantDataset(merchantId) in packages/paypal/src/sources; the loader is injected through buildApp(), so the swap is one line. (2) POST /api/advisor returns a FALLBACK_TEMPLATE AdvisorResponse until R4's runAdvisorTurn lands (injectable the same way). Both are marked TEMPORARY in code.
- Tests: supertest cases cover 200 valid / 400 invalid per route, 404, malformed JSON and CORS restriction. `pnpm -r build` and `pnpm -r test` are green.

### Requests to other owners

- **R2:** export MerchantDataset + getMerchantDataset(merchantId) from packages/paypal/src/sources (shape used: transactions, availableBalanceCents, balanceSource, openDisputes, excludedNonUsdCount).
- **R3:** confirm the fixture asOf anchor; optionally adopt the request schemas into @surplus/contracts.
- **R4:** export runAdvisorTurn from apps/api/src/agent with the injectable shape used here.

### R1 decisions and spike log (K-3, S-1, S-4, F-1, C-12, H-2)
### 2026-10-25 K-3 - Sandbox token check (R1)

Script: `packages/paypal/src/scripts/testToken.ts`.
Prints OK/FAIL and expiry seconds only; never the token value.
Awaiting human action: PayPal REST app creation and credential placement in `.env`.

### 2026-10-25 S-1 - Transaction Search, Balances, Disputes spike (R1)

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
        // FREE TEXT - stripped: transaction_subject, transaction_note, custom_field
      },
      payer_info: {
        account_id: string,
        email_address: string,   // PII - normalizer hashes this
        // FREE TEXT - stripped: payer_name.given_name, payer_name.surname
      },
      cart_info: { item_details: [...] }  // item_name is FREE TEXT - stripped
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

### 2026-10-25 S-4 - Webhook spike (R1)

Script: `packages/paypal/src/spikes/s4_webhook.ts`.
**Status: code complete, awaiting live run** (ngrok tunnel + PAYPAL_WEBHOOK_ID needed).

Expected verification flow:
1. POST /webhook -> collect raw body (no prior parse).
2. Extract headers: PAYPAL-TRANSMISSION-ID, PAYPAL-TRANSMISSION-TIME,
   PAYPAL-CERT-URL, PAYPAL-TRANSMISSION-SIG, PAYPAL-AUTH-ALGO.
3. POST /v1/notifications/verify-webhook-signature with those headers +
   webhook_id (PAYPAL_WEBHOOK_ID) + parsed event body.
4. verification_status === "SUCCESS" -> accept; anything else -> 400, zero DB write.

`verification_status: "SUCCESS"` will be recorded here once the live run completes.

### 2026-10-25 F-1 - PaypalClient decisions (R1)

**Framework choice:** Pure Node 20 built-in `fetch` + `node:crypto`. No extra HTTP
libraries. Reason: project rules prefer built-ins; Node 20 fetch is production-stable.

**Express vs Fastify:** Choosing **Express** for `apps/api`. Reason: simpler raw-body
middleware story (`express.raw()`) which is critical for the webhook route that must
read the exact bytes before any parsing. Fastify's `addContentTypeParser` achieves
the same but with more ceremony; the Express approach is more readable for the team.
Recorded here as the official framework choice.

**Token cache:** Single in-flight refresh using a pending-promise guard. Tokens are
cached until 5 minutes before their stated expiry. A protected-request 401 does not
invalidate the cache in this version; it surfaces as `PayPalError("HTTP_ERROR")`.
A failed OAuth token call surfaces as `PayPalError("OAUTH_FAILED")`.

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

**Request origin guard:** relative paths and absolute pagination links are resolved
against the configured `baseUrl`. Requests outside that origin, or URLs with embedded
credentials, throw `PayPalError("UNTRUSTED_ORIGIN")` before the bearer token is sent.

### 2026-10-25 F-9 - API routes decisions (R1)

Framework: **Express** (see F-1 decision above).

**asOf anchoring:**
- Fixture personas (`persona_*`): anchor `asOf` to `DEMO_AS_OF` from
  `@surplus/contracts/examples` (`"2026-10-01T00:00:00Z"`). This makes golden test
  values reproducible regardless of when the server runs.
- `live_sandbox`: use `new Date().toISOString()` (current time).

**Requests to other owners:**
- R2: confirm `getMerchantDataset(merchantId)` signature and return type
  `{ transactions, availableBalanceCents, balanceSource, openDisputes, excludedNonUsdCount }`.
  Routes use the temporary loader in `apps/api/src/routes/dataset.ts` until it lands.
- R3: `computeCashFlowSummary`, `computeSurplus`, `computeAllocationPlan` and
  `runScenarioComparison` are imported from `@surplus/engine`; confirm the signatures
  and `asOf: string` contract stay stable.
- R3: the local thin Zod wrappers live in `apps/api/src/routes/schemas.ts`; adopt them
  into `@surplus/contracts` later if the API and web client need shared parsing.

### 2026-10-25 C-5 - Webhooks + SSE decisions (R1)

**SQLite persistence on Render (C-12):** Default strategy is reseed on every boot
(no Render persistent disk, which costs $7/month). On restart, `webhook_events` rows
from live payments are lost. The live demo survives because judges do a fresh payment
after each demo. If needed for the video, R1 can add the `persistentDisk` section to
`render.yaml` (a human-only paid action, listed in the checklist).

### 2026-10-25 H-2 - Security audit scope (R1)

Findings audited: secrets in git history (gitleaks), CORS origin lockdown,
admin reset endpoint constant-time compare, webhook signature verification before
any DB write, Zod validation on all routes, log hygiene (no tokens, no free text,
no payer PII in any log line).

### 2026-10-25 C-5 webhooks and SSE (R1)

- POST /api/webhooks/paypal is mounted before JSON parsing and uses express.raw; signature verification runs on the exact bytes before any store call.
- Order enforced: verify -> parse -> dedupe by event id -> single atomic apply -> recompute -> broadcast -> 200. Unknown event types return 200 and write nothing; duplicates return 200 with no double count; invalid signatures return 400 with zero writes.
- Live merchant: every webhook is attributed to live_sandbox (PayPal does not echo our merchant id). Recorded as a deliberate scope decision for the demo.
- Event types handled: PAYMENT.CAPTURE.COMPLETED -> payment.received, PAYMENT.CAPTURE.REFUNDED (and the legacy PAYMENT.CAPTURE.REFUND alias) -> refund.processed. Each broadcasts the specific event plus a plan.updated event.
- Only USD, COMPLETED money movement is applied. Non-USD events are counted once in `excludedNonUsdCount`; pending/failed/denied events are acknowledged without a write.
- A refund never drives the cached balance below zero (clamped at the store boundary).
- Free text is never read: custom_id, notes, memos and payer names are ignored. Payer email is SHA-256 hashed to 8 hex chars at the edge.
- **TEMPORARY (request to R2):** apps/api/src/routes/webhookStore.ts provides an in-memory store and a minimal normalizer. Replace it with R2's better-sqlite3 db + normalizer; the controller depends on the concrete `InMemoryWebhookStore` today, so the swap touches server.ts and the dependency type.
- GET /api/events: text/event-stream, no-cache and no-transform, X-Accel-Buffering off, 15s heartbeat from SseHub.startHeartbeat, per-merchant subscribers, unsubscribe on req close.
- Tests: webhook coverage includes valid capture, raw-body verification, tampered signature with zero writes, duplicate id, refund, unknown type, missing headers, malformed amount, non-USD, non-COMPLETED and refund clamping; SseHub has 9 tests.
### 2026-10-25 C-12 Render deploy (R1)

- render.yaml defines surplus-api and surplus-web (Node 20, free plan, oregon, healthCheckPath /api/health). Secrets use sync: false; PAYPAL_API_BASE is fixed to Sandbox.
- API binds HOST=0.0.0.0 and reads PORT (Render-injected). WEB_ORIGIN is an exact-match CORS allowlist; NEXT_PUBLIC_API_URL is set on the web service after the API URL is known.
- Seed on boot: apps/api/src/routes/seed.ts seeds the store before listen; POST /api/admin/reset reseeds on demand. It is mounted only when ADMIN_RESET_TOKEN is non-empty.
- Admin reset compares SHA-256 digests with timingSafeEqual, so neither contents nor length leak. Missing or wrong header returns 401 with a safe body; the reset callback runs only on success.
- SQLite persistence decision: no Render disk, reseed on every boot. Live webhook rows (webhook_events, live transactions, adjusted balance) are lost on restart; the demo performs a fresh Sandbox payment after each deploy. A persistent disk section can be added later but costs money.
- TEMPORARY: seed.ts is an adapter; replace with R2's scripts/seed.ts hybrid seeder when it lands.
- Tests: 5 admin tests (missing, same-length wrong, different-length wrong, correct, unconfigured -> 404). Full workspace build and test green.
### 2026-10-25 H-2 security audit (R1)

Checked and changed:
- Secrets: no .env, key, or database file is tracked (git ls-files); no .env in history (git log --all -- .env); no key-shaped strings matched in tracked files; .env.example holds placeholders only and ADMIN_RESET_TOKEN now defaults to empty (route disabled).
- Injection and input: every route validates with zod; JSON bodies are capped at 100kb; webhook raw bodies at 1mb; malformed JSON returns 400; the error handler maps unknown failures to 500 internal_error and never prints stack traces or PayPal messages.
- Webhook trust: signature verification runs on the exact raw bytes before parsing or writing; tampered signatures return 400 with zero writes (tests cover balance, transaction, and event counts); replays are deduped by event id.
- Privacy: free text (custom_id, notes), payer name, and payer email are never read into storage; only an 8-char SHA-256 counterparty hash is kept; an H-2 test asserts the stored dataset contains neither the email nor the custom_id.
- Admin reset: constant-time SHA-256 digest compare via timingSafeEqual; empty config disables the route (404); missing or wrong token returns 401 and never calls reset.
- CORS: exact-match origin from WEB_ORIGIN, no wildcard, no credentials; preflight allow-headers are `Content-Type` and `x-admin-reset-token`.
- Headers: x-powered-by disabled; X-Content-Type-Options nosniff; Referrer-Policy no-referrer; X-Frame-Options DENY; Cache-Control no-store (SSE overrides with no-cache, no-transform).
- Dependencies: `pnpm audit --prod` currently reports 5 advisories: 2 high (`jsondiffpatch@0.6.0` prototype pollution via `ai@4.3.19`; `zod@3.25.76`), 1 moderate (`jsondiffpatch` XSS), and 2 low (`ai` filetype whitelist; `@ai-sdk/provider-utils` resource consumption). Next 15.5.28, React/react-dom 19.3.1 and the postcss 8.5.31 override are in place; the remaining advisories need coordinated breaking upgrades after the hackathon.
- No secrets are logged; the only console output is the listen address.

Residual risks accepted for the demo:
- zod 3.25.76 has GHSA-mrhx-c7xc-m3w5 high severity for memory exhaustion on oversized constrained collections; patched only in zod 4.6.6, which is a breaking upgrade for @surplus/contracts (R3). Mitigation: 100kb JSON cap plus request schemas that accept no unbounded arrays. Revisit after the hackathon.
- `ai@4.3.19` pulls `jsondiffpatch@0.6.0` (high prototype pollution; moderate XSS in its HTML formatter). Surplus does not apply untrusted JSON Patch deltas or render diff HTML, but the safe fix is `ai >= 5.0.52`, which is a breaking upgrade for R4's advisor. Revisit after the hackathon.
- /api/webhooks/paypal performs a signature verification call before it can know whether the sender is honest; an attacker can force verification work. Accepted because Render has no WAF and the endpoint must verify first. If it is abused, add a per-IP token bucket at the edge.
- No rate limit on POST /api/plan or /api/advisor; bodies are capped and the engine is pure, but an LLM call can be expensive. Add per-IP limits if public beyond the demo.

Requests to other owners:
- R5: apps/web now runs Next 15 + React 19. Use React 19 types; do not pin back. next/image is patched in 15.5.28.
- R3: consider zod 4.6.6+ after the hackathon to close the remaining advisory; the request schemas are R3-owned.
### 2026-10-25 H-2 follow-up: live seed correctness (R1)

- Found during the audit: C-12's seed adapter copied the fixture dataset into live_sandbox, so a fresh API could show a fake transaction and fixture balance for the live merchant before any real payment.
- seedOnBoot now seeds live_sandbox with EMPTY_LIVE_DATASET (zero transactions, zero balance, PAYPAL_REPORTING balance source is NOT claimed; the value is LIVE_WEBHOOK_ADJUSTED). Fixture personas keep using the example loader.
- Admin reset restores the same empty live state and clears applied event ids.
- Tests: seed.test.ts asserts an empty live start and idempotent reset; an app test serves summary, surplus and plan for an empty live merchant. 48 API tests pass.
- TODO(R2): replace EMPTY_LIVE_DATASET with the real PayPal reporting balance snapshot when getMerchantDataset lands.

