import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDatabasePath } from "./db";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

describe("resolveDatabasePath", () => {
  it("defaults to the repository root, not the current directory", () => {
    expect(resolveDatabasePath(undefined)).toBe(resolve(repoRoot, "surplus.db"));
  });

  it("resolves relative DATABASE_PATH values from the repository root", () => {
    expect(resolveDatabasePath("./data/surplus.db")).toBe(resolve(repoRoot, "data/surplus.db"));
  });

  it("keeps absolute paths and the in-memory database name", () => {
    const absolutePath = resolve(repoRoot, "tmp/surplus.db");

    expect(resolveDatabasePath(absolutePath)).toBe(absolutePath);
    expect(resolveDatabasePath(":memory:")).toBe(":memory:");
  });
});
