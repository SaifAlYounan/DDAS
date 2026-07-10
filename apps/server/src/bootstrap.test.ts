/**
 * infra-C3: the first-boot admin bootstrap must refuse a placeholder password
 * (e.g. the documented "change-me-please") unless explicitly overridden, so a
 * reference deploy can't silently ship a public, guessable admin.
 */
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor, type TestDb } from "@ddas/db/testing";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadEnv } from "./env.js";

describe.skipIf(!TEST_DATABASE_URL)("admin bootstrap password guard (infra-C3)", () => {
  let tdb: TestDb;

  beforeEach(async () => {
    // Fresh, admin-less schema before each case.
    tdb = await freshTestDb("bootstrap_guard");
  }, 30_000);

  afterAll(async () => {
    await tdb?.close();
  });

  const baseEnv = (overrides: Record<string, string>) =>
    loadEnv({
      DATABASE_URL: testDatabaseUrlFor("bootstrap_guard"),
      BLOB_DIR: "/tmp/ddas-bootstrap-guard",
      DDAS_ADMIN_EMAIL: "admin@example.com",
      ...overrides,
    });

  it("refuses a placeholder password with no escape", async () => {
    const env = baseEnv({ DDAS_ADMIN_PASSWORD: "change-me-please" });
    await expect(bootstrapAdmin(tdb.pool, env)).rejects.toThrow(/placeholder/i);
    const admins = await tdb.pool.query("SELECT 1 FROM role_assignments WHERE role = 'admin'");
    expect(admins.rows.length).toBe(0); // nothing created
  });

  it("allows the placeholder when DDAS_ALLOW_INSECURE_ADMIN=true", async () => {
    const env = baseEnv({
      DDAS_ADMIN_PASSWORD: "change-me-please",
      DDAS_ALLOW_INSECURE_ADMIN: "true",
    });
    const id = await bootstrapAdmin(tdb.pool, env);
    expect(id).toBeTruthy();
  });

  it("bootstraps normally with a real password", async () => {
    const env = baseEnv({ DDAS_ADMIN_PASSWORD: "a-genuinely-strong-secret" });
    const id = await bootstrapAdmin(tdb.pool, env);
    expect(id).toBeTruthy();
  });
});
