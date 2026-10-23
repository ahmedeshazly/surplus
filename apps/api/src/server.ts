// Owner: R1. Placeholder health server using only node:http so the team can pick Express or Fastify
// in Sprint 0 (record the choice in docs/decisions.md). Replace this file in task F-9.
import { createServer } from "node:http";

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url));
} catch {
  // .env is optional in CI and on fresh clones
}

const host = process.env["HOST"] ?? "127.0.0.1";
const port = Number(process.env["PORT"] ?? 4000);

createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "surplus-api" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not_found" }));
}).listen(port, host, () => {
  console.log(`surplus-api placeholder listening on http://${host}:${port}`);
});
