import { defineConfig } from "@playwright/test";

const SMOKE_DATABASE_URL =
  process.env["SMOKE_DATABASE_URL"] ?? "postgres://postgres@localhost:5432/ddas_smoke";
const PORT = 3210;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1, // one shared server + database — the flow is sequential anyway
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ./e2e/reset-db.mjs && node ../server/dist/main.js",
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    stdout: "ignore",
    env: {
      DATABASE_URL: SMOKE_DATABASE_URL,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      BLOB_DIR: "/tmp/ddas-smoke-blobs",
      WEB_DIST: new URL("./dist", import.meta.url).pathname,
      DDAS_ADMIN_EMAIL: "admin@smoke.test",
      DDAS_ADMIN_PASSWORD: "smoke-password-123",
      DDAS_EXTRACTION_PROVIDER: "stub",
      LOG_LEVEL: "warn",
    },
  },
});
