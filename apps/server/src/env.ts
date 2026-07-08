import { z } from "zod";

export const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  /** Where content-addressed document blobs live. */
  BLOB_DIR: z.string().default("/data/blobs"),
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
