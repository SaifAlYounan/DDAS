/**
 * buildApp(deps): the whole HTTP surface, dependency-injected for testability.
 * Tests hand in a pool pointed at a test database and a fake extraction
 * provider; main.ts hands in the real ones. No global state.
 */
import { createBlobStore, type BlobStore } from "@ddas/blob";
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
import { collectDefaultMetrics, Counter, Registry } from "prom-client";
import { ZodError } from "zod";
import type { Env } from "./env.js";
import { ApiError, toEnvelope } from "./errors.js";
import { registerJobs } from "./jobs/index.js";
import { parseTrustProxy } from "./cookies.js";
import { authPlugin } from "./plugins/auth.js";
import { rateLimitConfigFromEnv, rateLimitPlugin } from "./plugins/rate-limit.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAdminRoleRoutes } from "./routes/admin-roles.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerOrgRoutes } from "./routes/org.js";
import { registerPolicyRoutes } from "./routes/policies.js";
import { registerRequestRoutes } from "./routes/requests.js";
import { registerSimulationRoutes } from "./routes/simulations.js";
import { registerMcpRoute } from "./routes/mcp.js";
import { registerOidcRoutes } from "./routes/oidc.js";
import { registerScimRoutes, scimKeyIsolationHook } from "./routes/scim.js";
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

export interface AppCounters {
  requests: Counter;
  classifications: Counter<"status">;
  decisions: Counter<"outcome">;
  extractionRuns: Counter<"outcome">;
  webhookDeliveries: Counter<"outcome">;
  mcpCalls: Counter<"tool">;
}

export interface AppContext {
  pool: pg.Pool;
  db: Db;
  env: Env;
  blobs: BlobStore;
  boss: PgBoss | null;
  extractionProvider: ExtractionProvider | null;
  metrics: Registry;
  counters: AppCounters;
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

  // Blob storage first, fail-closed: with driver=s3 an unreachable bucket or
  // bad credentials must stop the boot with a clear error, not surface as a
  // failed upload later.
  const blobs = await createBlobStore({
    driver: env.DDAS_BLOB_DRIVER,
    dir: env.BLOB_DIR,
    s3: {
      endpoint: env.DDAS_S3_ENDPOINT,
      region: env.DDAS_S3_REGION,
      bucket: env.DDAS_S3_BUCKET ?? "",
      accessKeyId: env.DDAS_S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.DDAS_S3_SECRET_ACCESS_KEY ?? "",
      forcePathStyle: env.DDAS_S3_FORCE_PATH_STYLE,
    },
  });
  await blobs.probe();

  const db = createDb(pool);
  // Advisory-locked inside @ddas/db — concurrent replica boots serialize here.
  await migrate(pool);

  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    bodyLimit: 10 * 1024 * 1024,
    // Behind the HA TLS-terminating proxy: honor X-Forwarded-Proto/For so
    // request.protocol and request.ip reflect the real client (authn-C2).
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const metrics = new Registry();
  collectDefaultMetrics({ register: metrics });
  const counters: AppCounters = {
    requests: new Counter({
      name: "ddas_requests_total",
      help: "Authority requests submitted",
      registers: [metrics],
    }),
    classifications: new Counter({
      name: "ddas_classifications_total",
      help: "Classifications by result status",
      labelNames: ["status"],
      registers: [metrics],
    }),
    decisions: new Counter({
      name: "ddas_decisions_total",
      help: "Decisions by outcome",
      labelNames: ["outcome"],
      registers: [metrics],
    }),
    extractionRuns: new Counter({
      name: "ddas_extraction_runs_total",
      help: "LLM extraction runs by outcome",
      labelNames: ["outcome"],
      registers: [metrics],
    }),
    webhookDeliveries: new Counter({
      name: "ddas_webhook_deliveries_total",
      help: "Webhook delivery attempts by outcome",
      labelNames: ["outcome"],
      registers: [metrics],
    }),
    mcpCalls: new Counter({
      name: "ddas_mcp_calls_total",
      help: "MCP tool calls",
      labelNames: ["tool"],
      registers: [metrics],
    }),
  };

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
    blobs,
    boss,
    extractionProvider: deps.extractionProvider,
    metrics,
    counters,
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

  // Cookie signing keys the OIDC login-flow cookie (authn-S1); unset = unsigned (dev).
  await app.register(cookie, env.COOKIE_SECRET ? { secret: env.COOKIE_SECRET } : {});
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 10 } });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "LQGovernance - DDAS API",
        version: "2.0.0-alpha.0",
        description:
          "Dynamic Delegation of Authority System — appetite-constrained authority routing for humans and AI agents.",
      },
      servers: [{ url: "/" }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(authPlugin, { pool });
  // After auth: the limiter keys authenticated traffic per principal.
  await app.register(rateLimitPlugin, { pool, config: rateLimitConfigFromEnv(env) });
  // A "scim" token authenticates nothing outside /scim/v2 (and SCIM routes
  // accept nothing else) — the provisioning credential is fully isolated.
  app.addHook("onRequest", scimKeyIsolationHook);

  app.get("/healthz", async () => ({ ok: true }));
  app.get("/metrics", async (_request, reply) => {
    reply.header("content-type", metrics.contentType);
    return metrics.metrics();
  });
  app.get("/api/openapi.json", async () => app.swagger());
  registerMcpRoute(app as App, ctx);
  // SCIM 2.0 provisioning — its own prefix, media type, and error envelope;
  // hidden from the committed OpenAPI document (see docs/scim.md).
  registerScimRoutes(app as App, ctx);

  await app.register(
    async (api) => {
      registerAuthRoutes(api as unknown as App, ctx);
      registerOidcRoutes(api as unknown as App, ctx);
      registerAdminRoutes(api as unknown as App, ctx);
      registerAdminRoleRoutes(api as unknown as App, ctx);
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
