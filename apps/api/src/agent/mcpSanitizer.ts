/** Only page counts cross the MCP trust boundary. No PayPal strings are forwarded. */
export interface SanitizedMcpOutput {
  recordsOnPage?: number;
  totalItems?: number;
  totalPages?: number;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function payload(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4) throw new Error("MCP_RESULT_REJECTED");
  const result = object(value);
  if (!result || result["isError"] === true) throw new Error("MCP_RESULT_REJECTED");
  if (result["structuredContent"] !== undefined) {
    return payload(result["structuredContent"], depth + 1);
  }
  if (Array.isArray(result["content"])) {
    const blocks: unknown[] = result["content"];
    // Reject mixed media, multiple JSON documents, and plain-text errors.
    const block = blocks.length === 1 ? object(blocks[0]) : undefined;
    if (block?.["type"] !== "text" || typeof block["text"] !== "string") {
      throw new Error("MCP_RESULT_REJECTED");
    }
    try {
      return payload(JSON.parse(block["text"]) as unknown, depth + 1);
    } catch {
      throw new Error("MCP_RESULT_REJECTED");
    }
  }
  return result;
}

export function sanitizeMcpOutput(value: unknown): SanitizedMcpOutput {
  const raw = payload(value);
  const safe: SanitizedMcpOutput = {};
  const rows = raw["transaction_details"] ?? raw["items"] ?? raw["disputes"];
  if (Array.isArray(rows)) safe.recordsOnPage = rows.length;
  for (const [source, target] of [
    ["total_items", "totalItems"],
    ["total_pages", "totalPages"],
  ] as const) {
    const count = raw[source];
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
      safe[target] = count;
    }
  }
  return safe;
}
