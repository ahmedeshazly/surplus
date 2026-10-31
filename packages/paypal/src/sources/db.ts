// Owner: R2 – SQLite schema and helper for PayPal source layer
import Database from "better-sqlite3";
import { resolve } from "path";

/**
 * Returns a SQLite DB instance with WAL mode.
 * Uses `DATABASE_PATH` env var if set; otherwise falls back to a path
 * relative to the repository root. This works both in ESM (`type: "module"`)
 * and CommonJS contexts.
 */
export function getDb(): Database.Database {
  // Resolve a safe default when __dirname points inside the compiled package.
  const defaultPath = resolve(process.cwd(), "surplus.db");
  const dbPath = process.env.DATABASE_PATH ?? defaultPath;
  const db = new Database(dbPath);
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
  if (!shared) shared = getDb();
  return shared;
}
