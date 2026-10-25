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
- 2026-10-25T19:55:00+02:00 | K-3 | R1 | Merged sandbox oauth test:token script from origin/r1/k-3-sandbox-setup. All 6 members can run pnpm --filter @surplus/paypal test:token once creds in env.
