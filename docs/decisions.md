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

_Pending: window boundaries, executeAfterDays rule, band min/max under the CV shift, band-cents remainder rule._

## Open questions

_None yet._

---

## R1 decisions and spike log

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

### 2026-10-25 F-9 - API routes decisions (R1)

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

### 2026-10-25 C-5 - Webhooks + SSE decisions (R1)

**SQLite persistence on Render (C-12):** Default strategy is reseed on every boot
(no Render persistent disk, which costs $7/month). On restart, `webhook_events` rows
from live payments are lost. The live demo survives because judges do a fresh payment
after each demo. If needed for the video, R1 can add the `persistentDisk` section to
`render.yaml` (a human-only paid action, listed in the checklist).

### 2026-10-25 H-2 - Security audit notes (R1, to be completed Nov 5-9)

Findings to audit: secrets in git history (gitleaks), CORS origin lockdown,
admin reset endpoint constant-time compare, webhook signature verification before
any DB write, Zod validation on all routes, log hygiene (no tokens, no free text,
no payer PII in any log line).
