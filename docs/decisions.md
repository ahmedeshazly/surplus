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
