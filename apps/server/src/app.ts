/**
 * buildApp(deps): the whole HTTP surface, dependency-injected for testability.
 * Tests hand in a pool pointed at a test database and a fake extraction
 * provider; main.ts hands in the real ones. No global state.
 */
import { migrate, createDb, type Db } from "@ddas/db";
import type { ExtractionProvider } from "@ddas/extraction";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import swagger from "@fastify/swagger";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type pg from "pg";
import PgBoss from "pg-boss";
import { collectDefaultMetrics, Registry } from "prom-client";
import { ZodError } from "zod";
import type { Env } from "./env.js";
import { ApiError, toEnvelope } from "./errors.js";
import { registerJobs } from "./jobs/index.js";
import { authPlugin } from "./plugins/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerOrgRoutes } from "./routes/org.js";
import { registerPolicyRoutes } from "./routes/policies.js";
import { registerRequestRoutes } from "./routes/requests.js";
import { registerSimulationRoutes } from "./routes/simulations.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { startWebhookWorker, WEBHOOK_DEFAULTS } from "./jobs/webhooks.js";

export interface AppDeps {
  pool: pg.Pool;
  env: Env;
  /** Injected in tests; resolved from env in main.ts. Null = extraction jobs fail loudly. */
  extractionProvider: ExtractionProvider | null;
  /** Skip pg-boss startup (route-only tests). */
  withJobs?: boolean;
}

export interface AppContext {
  pool: pg.Pool;
  db: Db;
  env: Env;
  boss: PgBoss | null;
  extractionProvider: ExtractionProvider | null;
  metrics: Registry;
}

/** FastifyInstance WITH the Zod type provider — route modules keep schema inference. */
export type App = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
> & { ctx: AppContext };

export async function buildApp(deps: AppDeps): Promise<App> {
  const { pool, env } = deps;
  const db = createDb(pool);
  await migrate(db);

  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    bodyLimit: 10 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const metrics = new Registry();
  collectDefaultMetrics({ register: metrics });

  let boss: PgBoss | null = null;
  if (deps.withJobs !== false) {
    boss = new PgBoss({ connectionString: env.DATABASE_URL });
    boss.on("error", (err) => app.log.error({ err }, "pg-boss error"));
    await boss.start();
  }

  const ctx: AppContext = {
    pool,
    db,
    env,
    boss,
    extractionProvider: deps.extractionProvider,
    metrics,
  };
  (app as App).ctx = ctx;

  app.setErrorHandler((err: unknown, request, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.statusCode).send(toEnvelope(err));
    }
    const fastifyCode = (err as { code?: string }).code;
    if (err instanceof ZodError || fastifyCode === "FST_ERR_VALIDATION") {
      return reply.status(422).send({
        error: {
          code: "validation_failed",
          message: err instanceof Error ? err.message : "validation failed",
        },
      });
    }
    request.log.error({ err }, "unhandled error");
    return reply
      .status(500)
      .send({ error: { code: "internal", message: "internal server error" } });
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "DDAS API",
        version: "2.0.0-alpha.0",
        description:
          "Dynamic Delegation of Authority System — appetite-constrained authority routing for humans and AI agents.",
      },
      servers: [{ url: "/" }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(authPlugin, { pool });

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", metrics.contentType);
    return metrics.metrics();
  });
  app.get("/api/openapi.json", async () => app.swagger());

  await app.register(
    async (api) => {
      registerAuthRoutes(api as unknown as App, ctx);
      registerAdminRoutes(api as unknown as App, ctx);
      registerOrgRoutes(api as unknown as App, ctx);
      registerPolicyRoutes(api as unknown as App, ctx);
      registerRequestRoutes(api as unknown as App, ctx);
      registerApprovalRoutes(api as unknown as App, ctx);
      registerSimulationRoutes(api as unknown as App, ctx);
      registerAuditRoutes(api as unknown as App, ctx);
      registerWebhookRoutes(api as unknown as App, ctx);
    },
    { prefix: "/api/v1" }
  );

  if (boss) {
    await registerJobs(app as App, ctx);
    const stopWebhookWorker = startWebhookWorker(
      ctx,
      {
        pollMs: env.WEBHOOK_POLL_MS ?? WEBHOOK_DEFAULTS.pollMs,
        retryBaseMs: env.WEBHOOK_RETRY_BASE_MS ?? WEBHOOK_DEFAULTS.retryBaseMs,
        maxAttempts: WEBHOOK_DEFAULTS.maxAttempts,
        timeoutMs: WEBHOOK_DEFAULTS.timeoutMs,
      },
      (err) => app.log.error({ err }, "webhook sweep failed")
    );
    app.addHook("onClose", async () => stopWebhookWorker());
  }

  // Host the built web console when configured: static assets + SPA fallback
  // for anything that is not an API route.
  if (env.WEB_DIST) {
    const { default: fastifyStatic } = await import("@fastify/static");
    await app.register(fastifyStatic, { root: env.WEB_DIST, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api") || request.method !== "GET") {
        return reply
          .status(404)
          .send({ error: { code: "not_found", message: "route not found" } });
      }
      return (reply as unknown as { sendFile: (f: string) => unknown }).sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    if (boss) await boss.stop({ graceful: false });
  });

  return app as App;
}
