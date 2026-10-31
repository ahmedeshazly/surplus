// Owner: R2 – SQLite schema and helper for PayPal source layer
import Database from "better-sqlite3";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export function resolveDatabasePath(databasePath = process.env.DATABASE_PATH): string {
  if (databasePath === ":memory:") return databasePath;
  if (!databasePath) return resolve(repoRoot, "surplus.db");
  return isAbsolute(databasePath) ? databasePath : resolve(repoRoot, databasePath);
}

/**
 * Returns a SQLite DB instance with WAL mode.
 * `DATABASE_PATH` is resolved relative to the repository root, never the
 * current working directory.
 */
export function getDb(): Database.Database {
  const db = new Database(resolveDatabasePath());
  db.pragma("journal_mode = WAL");

  // Idempotent table creation – ensures the DB schema matches the source of truth.
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS normalized_transactions (
      id TEXT PRIMARY KEY,
      merchantId TEXT NOT NULL REFERENCES merchants(id),
      occurredAt TEXT NOT NULL,
      monthBucket TEXT NOT NULL,
      kind TEXT NOT NULL,
      grossCents INTEGER NOT NULL,
      feeCents INTEGER NOT NULL,
      netCents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      counterpartyHash TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS balances (
      merchantId TEXT PRIMARY KEY REFERENCES merchants(id),
      availableCents INTEGER NOT NULL,
      withheldCents INTEGER NOT NULL,
      asOf TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS open_disputes (
      disputeId TEXT PRIMARY KEY,
      merchantId TEXT NOT NULL REFERENCES merchants(id),
      amountCents INTEGER NOT NULL,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_events (
      eventId TEXT PRIMARY KEY,
      merchantId TEXT NOT NULL REFERENCES merchants(id),
      type TEXT NOT NULL,
      payload TEXT NOT NULL, -- will store only sanitized JSON (no free‑text fields)
      receivedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cached_plans (
      merchantId TEXT PRIMARY KEY REFERENCES merchants(id),
      planJson TEXT NOT NULL,
      cachedAt TEXT NOT NULL
    );
  `);
  return db;
}

let shared: Database.Database | null = null;
/**
 * Cached singleton DB instance. Safe for multiple imports within the same process.
 */
export function sharedDb(): Database.Database {
  // tiny comment to trigger PR UI – no functional change
  if (!shared) shared = getDb();
  return shared;
}
