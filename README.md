# Surplus

Explainable treasury runway and idle-cash allocation advisor for PayPal-paid freelancers and small merchants. A deterministic engine computes a safe-to-invest surplus, a tool-calling AI agent explains it, and a grounding validator checks every number. Built for the PayPal AI Hackathon.

> This README is a foundation stub. R6 owns it and expands it (architecture, Sandbox guide, data disclosure).

## Quickstart

Requirements: Node 20.12+ and pnpm 9 (`corepack enable`).

```bash
cp .env.example .env     # fill in Sandbox credentials from the team vault
pnpm install
pnpm seed
pnpm dev                 # web: http://localhost:3000   api: http://localhost:4000/health
```

Other commands: `pnpm -r build`, `pnpm -r test`, `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm --filter @surplus/paypal test:token`.

## Layout

```
apps/api            Node API (R1), agent/ is R4, routes/demoCheckout.ts is R2
apps/web            Next.js 14 dashboard (R5), app/pay-merchant is R2
packages/contracts  Shared types and Zod schemas (R3)
packages/engine     Pure deterministic engine (R3)
packages/paypal     PayPal client (R1) and data sources (R2)
fixtures, scripts   Persona fixtures and seeder (R2)
tests/e2e           Golden and compliance suites (R6)
docs                Decisions log, threat model, data notes, task assignments PDF
```

Who owns which path: `.github/ownership.json`. Full rules for humans and AI agents: `AGENT_CONTEXT.md`. Task list and gates: `docs/TEAM_TASK_ASSIGNMENTS.pdf`.

## Working agreement (short version)

- `main` is protected. One task = one branch = one PR, merged by the Team Leader (squash).
- Branch: `<role>/<task-id>-<slug>` (for example `r3/f-7-surplus-calculator`). PR title: `[F-7] short description`.
- Only edit files your role owns. Need a change elsewhere? Open a "Cross-owner change request" issue.
- Money is integer cents. The LLM never does math. Free text from PayPal never reaches the DB, UI or prompts.
- After Nov 4: bug fixes, tests, docs and polish only.

## One-time GitHub setup (Team Leader, R1)

1. On GitHub create an EMPTY public repo named `surplus` (no README, no license, no .gitignore).
2. Push the two prepared branches and open PR #1:

```bash
git remote add origin git@github.com:YOUR_USER_OR_ORG/surplus.git
git push -u origin main r1/k-2-monorepo-scaffold
gh pr create --base main --head r1/k-2-monorepo-scaffold --title "[K-2] Monorepo scaffold" --body "Scaffold, CI, repo rules. Acceptance: CI and gitleaks green on this PR."
```

3. When CI is green, squash-merge PR #1, then protect `main` (needs the GitHub CLI, `gh auth login`):

```bash
./scripts/gh-setup.sh YOUR_USER_OR_ORG/surplus
```

4. Add the 5 teammates as collaborators with write access. Put Sandbox credentials in the team vault, never in git.

If the repo lives in a GitHub organization, the gitleaks action needs a free `GITLEAKS_LICENSE` secret (personal accounts do not).

## License

Apache-2.0. See `LICENSE`.
