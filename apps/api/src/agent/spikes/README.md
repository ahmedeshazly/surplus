# R4 S-5 MCP spike

Run from the repository root with Node 20.19+ and pnpm 9:

```sh
pnpm install --frozen-lockfile
pnpm --filter @surplus/api test
pnpm --filter @surplus/api spike:mcp
```

The live command requires `PAYPAL_ACCESS_TOKEN` in the root, git-ignored `.env` or
the shell environment. Obtain a Sandbox token from R1's credential workflow. Never
paste a token into a command argument, commit it, or include it in a spike log.
No LLM key is needed for S-5: an offline mock model tests tool calling through the
Vercel AI SDK. The live command invokes the SDK-converted disputes tool directly.

## Trust boundary

- Launch the installed `@paypal/mcp` 1.8.1 with
  `--tools=transactions.list,disputes.list --paypal-environment=sandbox`.
- Never use `--tools=all`. Filter discovered tools again at the client boundary.
- Replace server descriptions with fixed descriptions.
- Return only observed page counts and valid integer pagination totals. No raw
  records, strings, IDs, names, emails, notes, messages, amounts, or URLs reach the
  caller. Monetary data for the advisor must come from the deterministic engine.
- Upstream errors become constant errors; subprocess stderr is suppressed.
- The child receives only its Sandbox token and environment, without AI keys or
  PayPal client secrets. Close the MCP client after use.

`recordsOnPage` counts records in this response, not all transactions or disputes.
Unknown insight fields are omitted until a safe, agreed schema exists.

## Package mismatch requiring R1 coordination

The plan calls for `get_merchant_insights`, but the published 1.8.1 CLI's accepted
selectors do not include insights. This implementation reports that tool as
unavailable instead of exposing other tools to enable it. The wrapper can accept
it if a future approved server offers it. Do not treat the fixture's insights tool
as proof that the installed PayPal server supports it.

## Completion evidence

The tests exercise an actual local stdio MCP fixture and AI SDK tool calls, with
injected notes, malicious descriptions, and an unwanted write tool. This verifies
the boundary without API keys. It does not prove Sandbox access. S-5 remains
pending until a live read succeeds and its sanitized output is appended to
`docs/decisions.md`.

References: [PayPal toolkit](https://github.com/paypal/agent-toolkit/tree/main/typescript)
and [AI SDK v4 tools](https://v4.ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).
The team has locked AI SDK v4; upgrading it is outside this task.
