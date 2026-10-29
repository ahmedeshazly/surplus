import { experimental_createMCPClient, tool } from "ai";
import type { Tool, ToolExecutionOptions } from "ai";
import { sanitizeMcpOutput } from "./mcpSanitizer.js";
import type { SanitizedMcpOutput } from "./mcpSanitizer.js";

export const READ_ONLY_MCP_TOOLS = [
  "list_transactions",
  "list_disputes",
  "get_merchant_insights",
] as const;

export const PAYPAL_SANDBOX_MCP_URL = "https://mcp.sandbox.paypal.com/sse";

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

export function hasAllRequiredReadOnlyTools(tools: Record<string, SafeMcpTool>) {
  return READ_ONLY_MCP_TOOLS.every((name) => tools[`paypal_mcp_${name}`] !== undefined);
}

/** Pass an explicit Sandbox token; never read AI keys or PayPal client secrets here. */
export async function connectPaypalMcp(accessToken: string) {
  if (!accessToken.trim()) throw new Error("PAYPAL_ACCESS_TOKEN_REQUIRED");
  let client: Client;
  try {
    client = await experimental_createMCPClient({
      name: "surplus-paypal-sandbox",
      transport: {
        type: "sse",
        url: PAYPAL_SANDBOX_MCP_URL,
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      onUncaughtError: () => {
        // Upstream text can contain sensitive data; keep it outside application logs.
      },
    });
  } catch {
    throw new Error("PAYPAL_MCP_CONNECTION_FAILED");
  }
  try {
    const discovered = await client.tools();
    const tools = wrapReadOnlyMcpTools(discovered);
    if (!hasAllRequiredReadOnlyTools(tools)) {
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
