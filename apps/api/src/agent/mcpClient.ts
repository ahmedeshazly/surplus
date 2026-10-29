import { createRequire } from "node:module";
import { experimental_createMCPClient, tool } from "ai";
import type { Tool, ToolExecutionOptions } from "ai";
import { Experimental_StdioMCPTransport } from "ai/mcp-stdio";
import { sanitizeMcpOutput } from "./mcpSanitizer.js";
import type { SanitizedMcpOutput } from "./mcpSanitizer.js";

export const READ_ONLY_MCP_TOOLS = [
  "list_transactions",
  "list_disputes",
  "get_merchant_insights",
] as const;

// @paypal/mcp 1.8.1 takes product.action selectors, not exposed MCP tool names.
// Its CLI does not support merchant insights; do not broaden to --tools=all.
export const PAYPAL_MCP_ARGS = [
  "--tools=transactions.list,disputes.list",
  "--paypal-environment=sandbox",
] as const;

type Client = Awaited<ReturnType<typeof experimental_createMCPClient>>;
type DiscoveredTools = Awaited<ReturnType<Client["tools"]>>;

interface McpTool {
  description?: string;
  parameters: DiscoveredTools[string]["parameters"];
  execute?: (args: unknown, options: ToolExecutionOptions) => PromiseLike<unknown>;
}

type SafeMcpTool = Tool<McpTool["parameters"], SanitizedMcpOutput> & {
  execute: (args: unknown, options: ToolExecutionOptions) => PromiseLike<SanitizedMcpOutput>;
};

export function wrapReadOnlyMcpTools(discovered: Record<string, McpTool>) {
  const safe: Record<string, SafeMcpTool> = {};
  for (const name of READ_ONLY_MCP_TOOLS) {
    const source = discovered[name];
    if (!source?.execute) continue;
    const execute = source.execute;
    safe[`paypal_mcp_${name}`] = tool({
      description: `Read PayPal ${name.replaceAll("_", " ")}. Returns sanitized page counts only.`,
      parameters: source.parameters,
      execute: async (args, options) => {
        try {
          return sanitizeMcpOutput(await execute(args, options));
        } catch {
          // Upstream errors may contain URLs, credentials or PayPal free text.
          throw new Error("PAYPAL_MCP_READ_FAILED");
        }
      },
    });
  }
  return safe;
}

/** Pass an explicit token; never inherit AI keys or client secrets into the subprocess. */
export async function connectPaypalMcp(accessToken: string) {
  if (!accessToken.trim()) throw new Error("PAYPAL_ACCESS_TOKEN_REQUIRED");
  const require = createRequire(import.meta.url);
  const transport = new Experimental_StdioMCPTransport({
    command: process.execPath,
    args: [require.resolve("@paypal/mcp/dist/index.js"), ...PAYPAL_MCP_ARGS],
    env: {
      PAYPAL_ACCESS_TOKEN: accessToken,
      PAYPAL_ENVIRONMENT: "SANDBOX",
    },
    stderr: "ignore",
  });
  let client: Client;
  try {
    client = await experimental_createMCPClient({ transport });
  } catch {
    await transport.close();
    throw new Error("PAYPAL_MCP_CONNECTION_FAILED");
  }
  try {
    const discovered = await client.tools();
    const tools = wrapReadOnlyMcpTools(discovered);
    if (!tools["paypal_mcp_list_transactions"] || !tools["paypal_mcp_list_disputes"]) {
      throw new Error("PAYPAL_MCP_REQUIRED_TOOL_MISSING");
    }
    return {
      tools,
      availableTools: READ_ONLY_MCP_TOOLS.filter((name) => discovered[name] !== undefined),
      unavailableTools: READ_ONLY_MCP_TOOLS.filter((name) => discovered[name] === undefined),
      close: () => client.close(),
    };
  } catch {
    await client.close();
    throw new Error("PAYPAL_MCP_DISCOVERY_FAILED");
  }
}
