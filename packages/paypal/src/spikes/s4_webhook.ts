/**
 * Owner: R1. Task S-4: Spike – Webhook receiver and signature verification.
 *
 * Minimal Express-based receiver that:
 * 1. Accepts POST /webhook from PayPal (via ngrok tunnel).
 * 2. Reads the raw body (required for signature verification).
 * 3. Verifies through POST /v1/notifications/verify-webhook-signature.
 * 4. Logs verification_status and the event type – never free text fields.
 *
 * Human actions required (see Human Action Checklist):
 *   a. Install ngrok: winget install ngrok
 *   b. Run in a separate terminal: ngrok http 4001
 *   c. Register the printed HTTPS URL + /webhook in PayPal Sandbox Developer
 *      Dashboard as a webhook, selecting event: PAYMENT.CAPTURE.COMPLETED
 *   d. Set PAYPAL_WEBHOOK_ID in .env to the Webhook ID shown in the dashboard.
 *   e. Trigger a payment on /pay-merchant (or do a Sandbox capture from Orders v2).
 *
 * Usage:
 *   PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... PAYPAL_WEBHOOK_ID=... \
 *     node --import tsx/esm src/spikes/s4_webhook.ts
 *
 * If credentials are absent, the script documents expected behavior and exits 0.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Load .env
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
  /* optional */
}

const clientId = process.env["PAYPAL_CLIENT_ID"] ?? "";
const clientSecret = process.env["PAYPAL_CLIENT_SECRET"] ?? "";
const webhookId = process.env["PAYPAL_WEBHOOK_ID"] ?? "";
const apiBase =
  process.env["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com";
const PORT = 4001;

// ---------------------------------------------------------------------------
// Credentials guard
// ---------------------------------------------------------------------------
if (!clientId || !clientSecret) {
  console.log(
    "S-4 SPIKE: credentials not set. Documenting expected flow; exiting 0.",
  );
  console.log("");
  console.log("Expected flow:");
  console.log("  1. POST /webhook receives raw body from PayPal.");
  console.log("  2. Extract headers:");
  console.log(
    "       PAYPAL-TRANSMISSION-ID, PAYPAL-TRANSMISSION-TIME, PAYPAL-CERT-URL,",
  );
  console.log("       PAYPAL-TRANSMISSION-SIG, PAYPAL-AUTH-ALGO");
  console.log(
    "  3. POST /v1/notifications/verify-webhook-signature with those headers +",
  );
  console.log("       webhook_id (from PAYPAL_WEBHOOK_ID env) + raw body.");
  console.log(
    "  4. verification_status === 'SUCCESS' => event is genuine; otherwise reject.",
  );
  process.exit(0);
}

if (!webhookId) {
  console.warn(
    "WARNING: PAYPAL_WEBHOOK_ID not set. Signature verification will fail once a webhook arrives.",
  );
}

// ---------------------------------------------------------------------------
// OAuth token cache (minimal for spike)
// ---------------------------------------------------------------------------
let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return _token;
}

// ---------------------------------------------------------------------------
// Verify webhook signature
// ---------------------------------------------------------------------------
async function verifySignature(
  headers: Record<string, string>,
  rawBody: string,
): Promise<boolean> {
  const token = await getToken();
  const payload = {
    auth_algo: headers["paypal-auth-algo"] ?? "",
    cert_url: headers["paypal-cert-url"] ?? "",
    transmission_id: headers["paypal-transmission-id"] ?? "",
    transmission_sig: headers["paypal-transmission-sig"] ?? "",
    transmission_time: headers["paypal-transmission-time"] ?? "",
    webhook_id: webhookId,
    webhook_event: JSON.parse(rawBody) as unknown,
  };

  const res = await fetch(
    `${apiBase}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    },
  );

  const data = (await res.json()) as { verification_status?: string };
  return data.verification_status === "SUCCESS";
}

// ---------------------------------------------------------------------------
// Minimal HTTP server
// ---------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/webhook") {
    res.writeHead(404);
    res.end();
    return;
  }

  // Collect raw body (critical – must not be parsed first)
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const rawBody = Buffer.concat(chunks).toString("utf8");

  // Extract verification headers (lowercase)
  const hdrs: Record<string, string> = {};
  for (const key of [
    "paypal-transmission-id",
    "paypal-transmission-time",
    "paypal-cert-url",
    "paypal-transmission-sig",
    "paypal-auth-algo",
  ]) {
    hdrs[key] = (req.headers[key] as string | undefined) ?? "";
  }

  let verified = false;
  try {
    verified = await verifySignature(hdrs, rawBody);
  } catch (err) {
    console.error("Signature verification error:", String(err));
    res.writeHead(500);
    res.end();
    return;
  }

  if (!verified) {
    console.warn("WEBHOOK REJECTED: verification_status != SUCCESS");
    res.writeHead(400);
    res.end();
    return;
  }

  // Parse event – only log non-free-text fields
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  const eventId = String(event["id"] ?? "");
  const eventType = String(event["event_type"] ?? "");
  const createTime = String(event["create_time"] ?? "");

  console.log("WEBHOOK VERIFIED: verification_status=SUCCESS");
  console.log(`  event_id   : ${eventId}`);
  console.log(`  event_type : ${eventType}`);
  console.log(`  create_time: ${createTime}`);
  // Deliberately NOT logging summary.amount (safe) vs free text fields (unsafe)
  const resource = event["resource"] as Record<string, unknown> | undefined;
  if (resource) {
    const amount = resource["amount"] as Record<string, unknown> | undefined;
    if (amount) {
      // currency_code and value are structural – safe to log
      console.log(
        `  amount     : ${String(amount["currency_code"])} ${String(amount["value"])}`,
      );
    }
    console.log(`  resource_id: ${String(resource["id"] ?? "")}`);
    console.log(`  status     : ${String(resource["status"] ?? "")}`);
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ received: true }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`S-4 SPIKE server listening on port ${PORT}`);
  console.log(
    `Register ngrok tunnel URL https://<id>.ngrok.io/webhook as PayPal Sandbox webhook.`,
  );
  console.log(
    "Make a Sandbox payment to trigger PAYMENT.CAPTURE.COMPLETED and verify SUCCESS.",
  );
});
