import { z } from "zod";

export const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  /** Blob storage driver: local filesystem (default) or any S3-compatible store. */
  DDAS_BLOB_DRIVER: z.enum(["fs", "s3"]).default("fs"),
  /** fs driver: where content-addressed document blobs live. */
  BLOB_DIR: z.string().default("/data/blobs"),
  /** s3 driver: endpoint URL — leave unset for AWS itself; set for MinIO/R2/Ceph. */
  DDAS_S3_ENDPOINT: z.string().optional(),
  DDAS_S3_REGION: z.string().optional(),
  DDAS_S3_BUCKET: z.string().optional(),
  DDAS_S3_ACCESS_KEY_ID: z.string().optional(),
  DDAS_S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Path-style addressing — required by MinIO and most self-hosted stores. */
  DDAS_S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
  /** Built SPA directory; when set, the server hosts the web console. */
  WEB_DIST: z.string().optional(),
  /** Boot-time admin bootstrap: created iff no admin exists yet. */
  DDAS_ADMIN_EMAIL: z.string().email().optional(),
  DDAS_ADMIN_PASSWORD: z.string().min(12).optional(),
  /** Extraction provider is configured via the DDAS_EXTRACTION_* variables
   *  read by @ddas/extraction's providerFromEnv (provider/model/api key/base url). */
  DDAS_EXTRACTION_PROVIDER: z.string().optional(),
  DDAS_EXTRACTION_MODEL: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Node runtime mode. In "production" cookies are forced Secure even if a
   *  proxy header is missing (authn-C2 belt-and-suspenders). */
  NODE_ENV: z.string().optional(),
  /**
   * Trust the reverse proxy's X-Forwarded-* headers (authn-C2): behind a
   * TLS-terminating proxy this makes request.protocol reflect the real
   * client scheme (so session cookies keep Secure) and request.ip the real
   * client IP (so per-IP rate limits don't collapse to one bucket).
   * "true"/"false" or a comma-separated IP/CIDR allowlist of trusted hops.
   */
  TRUST_PROXY: z.string().default("true"),
  /**
   * Secret (>=32 chars) for signing the OIDC login-flow cookie (authn-S1).
   * Set in production/HA — it must be shared across replicas so any node can
   * validate the flow cookie. When unset the flow cookie is unsigned (dev).
   */
  COOKIE_SECRET: z.string().min(32).optional(),
  /** OIDC/SSO — set all three to enable; JIT-provisions on first login. */
  OIDC_ISSUER_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  /** Must match the IdP registration, e.g. https://ddas.example.com/api/v1/auth/oidc/callback */
  OIDC_REDIRECT_URL: z.string().url().optional(),
  /** Roles granted to JIT-provisioned users (comma-separated). */
  OIDC_DEFAULT_ROLES: z.string().default("requester"),
  /** Allow http:// issuers — tests and lab setups only. */
  OIDC_ALLOW_INSECURE: z.coerce.boolean().default(false),
  /** Webhook delivery worker tuning (tests shrink these). */
  WEBHOOK_POLL_MS: z.coerce.number().int().positive().optional(),
  WEBHOOK_RETRY_BASE_MS: z.coerce.number().int().positive().optional(),
  /**
   * Per-route-class rate limits (fixed window, Postgres-backed so they hold
   * across every app node). Limit = max requests per window; 0 disables the
   * class. /healthz and /metrics are never rate-limited.
   */
  RATE_LIMIT_AUTH_LIMIT: z.coerce.number().int().nonnegative().default(30),
  RATE_LIMIT_AUTH_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MUTATION_LIMIT: z.coerce.number().int().nonnegative().default(120),
  RATE_LIMIT_MUTATION_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_READ_LIMIT: z.coerce.number().int().nonnegative().default(600),
  RATE_LIMIT_READ_WINDOW_SEC: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_ADMIN_LIMIT: z.coerce.number().int().nonnegative().default(120),
  RATE_LIMIT_ADMIN_WINDOW_SEC: z.coerce.number().int().positive().default(60),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid environment: ${detail}`);
  }
  return parsed.data;
}
