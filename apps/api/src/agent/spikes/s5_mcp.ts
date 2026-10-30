import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { connectPaypalMcp } from "../mcpClient.js";

export async function runMcpSpike() {
  try {
    process.loadEnvFile(new URL("../../../../../.env", import.meta.url));
  } catch {
    // Environment variables can also be supplied by the shell or vault.
  }
  const token = process.env["PAYPAL_SANDBOX_ACCESS_TOKEN"] ?? process.env["PAYPAL_ACCESS_TOKEN"];
  if (!token) {
    throw new Error("Set PAYPAL_SANDBOX_ACCESS_TOKEN locally before running the S-5 live spike.");
  }

  // A hard deadline also covers a hung remote SSE connection.
  const deadline = setTimeout(() => {
    console.error("S-5 live spike timed out.");
    process.exit(1);
  }, 20_000);
  try {
    const session = await connectPaypalMcp(token);
    try {
      const list = session.tools["paypal_mcp_list_disputes"];
      if (!list?.execute) throw new Error("Required read-only tool is unavailable.");
      const result = await list.execute({}, { toolCallId: "s5-disputes", messages: [] });
      console.log(
        JSON.stringify(
          {
            availableTools: session.availableTools,
            unavailableTools: session.unavailableTools,
            sanitizedOutput: result,
          },
          null,
          2,
        ),
      );
    } finally {
      await session.close();
    }
  } finally {
    clearTimeout(deadline);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMcpSpike().catch(() => {
    console.error(
      "S-5 live spike failed. Check PAYPAL_SANDBOX_ACCESS_TOKEN and Sandbox permissions locally.",
    );
    process.exitCode = 1;
  });
}
