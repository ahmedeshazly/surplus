# R4 S-5 MCP spike

Run from the repository root with Node 20.19+ and pnpm 9:

```sh
pnpm install --frozen-lockfile
pnpm --filter @surplus/api test
pnpm --filter @surplus/api spike:mcp
```

The live command requires `PAYPAL_SANDBOX_ACCESS_TOKEN` in the root, git-ignored
`.env` or shell environment. The legacy `PAYPAL_ACCESS_TOKEN` name remains accepted
temporarily. Obtain a Sandbox token from R1's credential workflow. Never paste a
token into a command argument, commit it, or include it in a spike log.
No LLM key is needed for S-5: an offline mock model tests tool calling through the
Vercel AI SDK. The live command invokes the SDK-converted disputes tool directly.

## Trust boundary

- Connect to PayPal AI Toolkit's official Sandbox MCP endpoint at
  `https://mcp.sandbox.paypal.com/sse` with the token in an Authorization header.
- Filter every discovered tool at the client boundary. Only `list_transactions`,
  `list_disputes`, and `get_merchant_insights` can reach the advisor.
- Replace server descriptions with fixed descriptions.
- Return only observed page counts and valid integer pagination totals. No raw
  records, strings, IDs, names, emails, notes, messages, amounts, or URLs reach the
  caller. Monetary data for the advisor must come from the deterministic engine.
- Upstream errors become constant errors and are not copied into application logs.
- The MCP transport receives only its Sandbox token. It does not receive AI keys
  or PayPal client secrets. Close the MCP client after use.

`recordsOnPage` counts records in this response, not all transactions or disputes.
Unknown insight fields are omitted until a safe, agreed schema exists.

## PayPal AI Toolkit

Install the official Codex plugin with `codex plugin marketplace add
paypal/AI-Toolkit` and `codex plugin add paypal@paypal-ai-toolkit`, then restart
Codex. The plugin provides current PayPal integration guidance and configures the
same Sandbox SSE endpoint. The application still enforces its own read-only
allowlist and sanitizer; installing the developer plugin is not an application
security boundary.

## Completion evidence

The tests exercise a local stdio MCP fixture and AI SDK tool calls, with injected
notes, malicious descriptions, and an unwanted write tool. This verifies the
application boundary without API keys. Live Sandbox evidence for all three required
tools and a sanitized `list_disputes` invocation is recorded in
`docs/decisions.md`.

References: [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit),
[PayPal MCP server](https://developer.paypal.com/ai-tools/mcp-server/), and
[AI SDK v4 tools](https://v4.ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling).
The team has locked AI SDK v4; upgrading it is outside this task.
