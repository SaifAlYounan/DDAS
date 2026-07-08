import { providerFromEnv } from "@ddas/extraction";
import pg from "pg";
import { buildApp } from "./app.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

const extractionProvider = (() => {
  try {
    return providerFromEnv(process.env);
  } catch {
    return null;
  }
})();

const app = await buildApp({ pool, env, extractionProvider });
const adminId = await bootstrapAdmin(pool, env);
if (adminId) app.log.info({ adminId }, "bootstrapped initial admin");
if (!extractionProvider) {
  app.log.warn("no extraction provider configured — submissions will fail at extraction");
}

await app.listen({ port: env.PORT, host: env.HOST });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
