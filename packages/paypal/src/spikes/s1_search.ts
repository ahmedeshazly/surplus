/**
 * Owner: R1. Task S-1: Spike – Transaction Search, Balances, Disputes.
 *
 * Logs RESPONSE SHAPES (field names and types only – no free text, no secrets,
 * no real email addresses, no payer names) to stdout.
 * Results are recorded in docs/decisions.md under "S-1 Transaction Search, Balances, Disputes".
 *
 * Usage:
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... node --import tsx/esm src/spikes/s1_search.ts
 *   OR:
 *   pnpm --filter @surplus/paypal exec tsx src/spikes/s1_search.ts
 *
 * If credentials are absent the script documents the code paths and exits 0.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Load .env from repo root (optional)
// ---------------------------------------------------------------------------
try {
  const envPath = resolve(
    new URL("../../../../.env", import.meta.url).pathname.slice(
      process.platform === "win32" ? 1 : 0,
    ),
  );
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  /* .env optional */
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively describe the shape of a JSON value (types, not values). */
function describeShape(
  val: unknown,
  depth = 0,
): string {
  if (val === null) return "null";
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    // Describe only the first element to stay terse.
    return `[${describeShape(val[0], depth + 1)}, ...]  (length=${val.length})`;
  }
  if (typeof val === "object") {
    if (depth > 3) return "{...}";
    const entries = Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${describeShape(v, depth + 1)}`)
      .join(", ");
    return `{ ${entries} }`;
  }
  return typeof val;
}

const clientId = process.env["PAYPAL_CLIENT_ID"] ?? "";
const clientSecret = process.env["PAYPAL_CLIENT_SECRET"] ?? "";
const apiBase =
  process.env["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com";

// ---------------------------------------------------------------------------
// Credentials guard
// ---------------------------------------------------------------------------
if (!clientId || !clientSecret) {
  console.log(
    "S-1 SPIKE: credentials not set. Documenting code paths only; exiting 0.",
  );
  console.log(
    "Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env to run the live spike.",
  );
  console.log("");
  console.log("Expected endpoints:");
  console.log("  GET /v1/oauth2/token           – client_credentials grant");
  console.log(
    "  GET /v1/reporting/transactions – params: start_date, end_date, page_size, page",
  );
  console.log(
    "  GET /v1/reporting/balances     – params: as_of_time (RFC3339)",
  );
  console.log(
    "  GET /v1/customer/disputes      – params: dispute_state, page_size, start_time",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// OAuth token
// ---------------------------------------------------------------------------
async function getToken(): Promise<string> {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token; // used only inside headers; never logged
}

// ---------------------------------------------------------------------------
// Main spike
// ---------------------------------------------------------------------------
console.log(`S-1 SPIKE: connecting to ${apiBase}`);

let token: string;
try {
  token = await getToken();
  console.log("OAuth: SUCCESS (token obtained, not logged)");
} catch (err) {
  console.error("OAuth FAILED:", String(err));
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

// ── 1. Transaction Search ──────────────────────────────────────────────────
console.log("\n── 1. GET /v1/reporting/transactions ──");
{
  // Use last 7 days as the spike window (safe within the 31-day limit).
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
  const params = new URLSearchParams({
    start_date: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
    end_date: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
    page_size: "5",
    page: "1",
  });

  try {
    const res = await fetch(
      `${apiBase}/v1/reporting/transactions?${params}`,
      { headers, signal: AbortSignal.timeout(20_000) },
    );
    const body = (await res.json()) as unknown;
    console.log(`  Status: ${res.status}`);
    console.log(`  Shape: ${describeShape(body)}`);

    // Record key field names for decisions.md
    if (
      typeof body === "object" &&
      body !== null &&
      "transaction_details" in body
    ) {
      const details = (body as { transaction_details: unknown[] })
        .transaction_details;
      if (details.length > 0) {
        console.log(
          "  transaction_details[0] shape:",
          describeShape(details[0]),
        );
      }
    }
  } catch (err) {
    console.error("  FAILED:", String(err));
  }
}

// ── 2. Balances ───────────────────────────────────────────────────────────
console.log("\n── 2. GET /v1/reporting/balances ──");
{
  const asOf = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({ as_of_time: asOf });
  try {
    const res = await fetch(
      `${apiBase}/v1/reporting/balances?${params}`,
      { headers, signal: AbortSignal.timeout(20_000) },
    );
    const body = (await res.json()) as unknown;
    console.log(`  Status: ${res.status}`);
    console.log(`  Shape: ${describeShape(body)}`);
  } catch (err) {
    console.error("  FAILED:", String(err));
  }
}

// ── 3. Open Disputes ──────────────────────────────────────────────────────
console.log("\n── 3. GET /v1/customer/disputes ──");
{
  const params = new URLSearchParams({
    dispute_state: "OPEN_INQUIRIES,REQUIRED_ACTION,UNDER_REVIEW",
    page_size: "5",
  });
  try {
    const res = await fetch(
      `${apiBase}/v1/customer/disputes?${params}`,
      { headers, signal: AbortSignal.timeout(20_000) },
    );
    const body = (await res.json()) as unknown;
    console.log(`  Status: ${res.status}`);
    console.log(`  Shape: ${describeShape(body)}`);
  } catch (err) {
    console.error("  FAILED:", String(err));
  }
}

console.log("\nS-1 SPIKE COMPLETE. Record shapes in docs/decisions.md.");
