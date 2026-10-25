// Owner: R1. Task C-5/C-12: API process entry point.
// Wires the real PaypalClient (when credentials exist), seeds on boot, mounts
// the protected admin reset, then starts Express. The dataset loader stays on
// the example adapter until R2's SQLite store lands (marked TEMPORARY).
import { PaypalClient } from "@surplus/paypal";
import { buildApp } from "./app";
import { exampleDatasetLoader } from "./routes/dataset";
import { seedOnBoot } from "./routes/seed";
import { SseHub } from "./routes/sseHub";
import { InMemoryWebhookStore } from "./routes/webhookStore";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // .env is optional in CI and on fresh clones
}

const host = process.env["HOST"] ?? "127.0.0.1";
const port = Number(process.env["PORT"] ?? 4000);

const hub = new SseHub();
const store = new InMemoryWebhookStore();
await seedOnBoot(store, exampleDatasetLoader);

const clientId = process.env["PAYPAL_CLIENT_ID"];
const clientSecret = process.env["PAYPAL_CLIENT_SECRET"];
const webhookId = process.env["PAYPAL_WEBHOOK_ID"];
const adminResetToken = process.env["ADMIN_RESET_TOKEN"] ?? "";
const apiBase = process.env["PAYPAL_API_BASE"] ?? "https://api-m.sandbox.paypal.com";

const client =
  clientId !== undefined && clientSecret !== undefined
    ? new PaypalClient({ clientId, clientSecret, baseUrl: apiBase })
    : undefined;

const app = buildApp({
  loadDataset: (merchantId) => store.getDataset(merchantId) ?? exampleDatasetLoader(merchantId),
  sseHub: hub,
  webhook:
    client !== undefined && webhookId !== undefined
      ? {
          store,
          verify: (headers, rawBody) => client.verifyWebhookSignature(headers, rawBody, webhookId),
        }
      : undefined,
  admin: {
    token: adminResetToken,
    reset: async () => {
      await seedOnBoot(store, exampleDatasetLoader);
    },
  },
});

hub.startHeartbeat(15_000);

app.listen(port, host, () => {
  console.log(`surplus-api listening on http://${host}:${port}`);
});
