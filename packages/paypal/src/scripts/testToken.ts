/**
 * Owner: R1. Task K-3: Sandbox OAuth client-credentials token check.
 *
 * Prints ONLY success/failure and token expiry – never the token itself.
 * Usage: pnpm --filter @surplus/paypal test:token
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env from repo root (optional – CI can skip)
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
  // .env is optional in CI; credentials must come from process.env
}

const clientId = process.env["PAYPAL_CLIENT_ID"];
const clientSecret = process.env["PAYPAL_CLIENT_SECRET"];
const apiBase =
  process.env["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com";

if (!clientId || !clientSecret) {
  console.error(
    "FAIL: PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is not set in .env or environment.",
  );
  console.error("Set these variables and re-run: pnpm --filter @surplus/paypal test:token");
  process.exit(1);
}

const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
  "base64",
);

let res: Response;
try {
  res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`FAIL: Network error contacting ${apiBase} – ${msg}`);
  process.exit(1);
}

if (!res.ok) {
  let detail = "";
  try {
    const body = (await res.json()) as Record<string, unknown>;
    // Redact any token-like fields; only surface error description
    detail = String(body["error_description"] ?? body["error"] ?? "");
  } catch {
    detail = await res.text().catch(() => "");
  }
  console.error(
    `FAIL: PayPal responded ${res.status} ${res.statusText}${detail ? ` – ${detail}` : ""}`,
  );
  process.exit(1);
}

let data: Record<string, unknown>;
try {
  data = (await res.json()) as Record<string, unknown>;
} catch {
  console.error("FAIL: Could not parse PayPal token response as JSON.");
  process.exit(1);
}

const expiresIn = Number(data["expires_in"] ?? 0);
const tokenType = String(data["token_type"] ?? "Bearer");
const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

// Never log the access_token itself.
console.log(`OK: PayPal Sandbox OAuth token obtained.`);
console.log(`    Token type : ${tokenType}`);
console.log(`    Expires in : ${expiresIn}s  (at ${expiresAt})`);
console.log(`    Base URL   : ${apiBase}`);
