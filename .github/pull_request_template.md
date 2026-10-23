## Task

<!-- Task id and title, e.g. F-7 Surplus calculator. Title format: [F-7] short description -->

## What changed

## Acceptance criteria (copy from docs/TEAM_TASK_ASSIGNMENTS.pdf or AGENT_CONTEXT.md Section 8)

- [ ]
- [ ]

## How to test

```bash
pnpm install
pnpm -r test
```

## Cross-owner or contract impact

<!-- None, or list the owner you asked and link the issue. Contract changes go through R3. -->

## Checklist

- [ ] I only changed files owned by my role
- [ ] All money is integer cents, no float money math outside display formatting
- [ ] Types come from `@surplus/contracts`, none redefined, no `any`
- [ ] No free-text PayPal fields reach the DB, UI or prompts
- [ ] No secrets, and no new dependency after Nov 4
- [ ] Tests exist and pass, CI is green
- [ ] Spike results or decisions appended to `docs/decisions.md`
