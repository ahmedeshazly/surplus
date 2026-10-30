// Owner: R1. Task F-9: API process entry point. Builds the Express app and listens.
// The database-backed dataset loader (C-12) replaces the example loader on boot.
import { buildApp } from "./app";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // .env is optional in CI and on fresh clones
}

const host = process.env["HOST"] ?? "127.0.0.1";
const port = Number(process.env["PORT"] ?? 4000);

const app = buildApp();

app.listen(port, host, () => {
  console.log(`surplus-api listening on http://${host}:${port}`);
});
