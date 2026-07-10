/**
 * s3 blob driver, end to end — a focused boot of the real server with
 * DDAS_BLOB_DRIVER=s3 against a MinIO container:
 *   submit → the blob lands in the bucket (content-addressed, same key
 *   layout as fs) → extraction reads the text → the authed document-text
 *   route serves it — and stays 401 without a session, because blobs never
 *   become directly reachable; plus the fail-fast boot probe on a bad bucket.
 * Needs TEST_DATABASE_URL and TEST_S3_ENDPOINT; skips otherwise.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { createBlobStore, type BlobStore } from "@ddas/blob";
import { freshTestDb, TEST_DATABASE_URL, testDatabaseUrlFor } from "@ddas/db/testing";
import type { ExtractionProvider } from "@ddas/extraction";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "./app.js";
import { bootstrapAdmin } from "./bootstrap.js";
import { loadEnv } from "./env.js";

const TEST_S3_ENDPOINT = process.env["TEST_S3_ENDPOINT"];
const S3_CREDS = {
  accessKeyId: process.env["TEST_S3_ACCESS_KEY_ID"] ?? "test",
  secretAccessKey: process.env["TEST_S3_SECRET_ACCESS_KEY"] ?? "testtest123",
};

if (TEST_DATABASE_URL && !TEST_S3_ENDPOINT) {
  // eslint-disable-next-line no-console
  console.warn("skipping s3 e2e suite (needs TEST_S3_ENDPOINT, e.g. a MinIO container)");
}

const CORPUS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/testkit/corpus/kolvarra"
);

interface CorpusCase {
  case_id: string;
  documents: Array<{ path: string }>;
  labeled_facts: Array<{
    id: string;
    status: "FOUND" | "NOT_FOUND";
    value?: unknown;
    unit?: string;
    citation?: { doc_index: number; text: string };
  }>;
}

function labeledFactsProvider(c: CorpusCase): ExtractionProvider {
  return {
    id: "fake",
    model: "labeled-facts-v1",
    async complete(): Promise<string> {
      return JSON.stringify({
        facts: c.labeled_facts.map((f) =>
          f.status === "NOT_FOUND"
            ? { id: f.id, status: "NOT_FOUND" }
            : {
                id: f.id,
                status: "FOUND",
                value: f.value,
                ...(f.unit ? { unit: f.unit } : {}),
                confidence: 0.95,
                citation: { doc_index: f.citation!.doc_index, quote: f.citation!.text },
              }
        ),
      });
    },
  };
}

function multipart(
  fields: Record<string, string>,
  files: Array<{ filename: string; content: string }>
): { payload: string; headers: Record<string, string> } {
  const boundary = "----ddasS3E2EBoundary42";
  let payload = "";
  for (const [name, value] of Object.entries(fields)) {
    payload += `--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  for (const file of files) {
    payload += `--${boundary}\r\ncontent-disposition: form-data; name="files"; filename="${file.filename}"\r\ncontent-type: text/plain\r\n\r\n${file.content}\r\n`;
  }
  payload += `--${boundary}--\r\n`;
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe.skipIf(!TEST_DATABASE_URL || !TEST_S3_ENDPOINT)("server e2e (s3 blob driver)", () => {
  let app: App;
  let pool: pg.Pool;
  let bucket: string;
  let bucketStore: BlobStore;
  const cookies: Record<string, string> = {};

  const flagship = JSON.parse(
    readFileSync(path.join(CORPUS_DIR, "cases", "vendor-msa-high-value.json"), "utf8")
  ) as CorpusCase;
  const caseDocs = flagship.documents.map((d) => ({
    filename: path.basename(d.path),
    content: readFileSync(path.join(CORPUS_DIR, d.path), "utf8"),
  }));

  const s3Env = (bucketName: string) => ({
    DATABASE_URL: testDatabaseUrlFor("s3e2e"),
    DDAS_BLOB_DRIVER: "s3",
    DDAS_S3_ENDPOINT: TEST_S3_ENDPOINT!,
    DDAS_S3_REGION: "us-east-1",
    DDAS_S3_BUCKET: bucketName,
    DDAS_S3_ACCESS_KEY_ID: S3_CREDS.accessKeyId,
    DDAS_S3_SECRET_ACCESS_KEY: S3_CREDS.secretAccessKey,
    DDAS_S3_FORCE_PATH_STYLE: "true",
    DDAS_ADMIN_EMAIL: "admin@s3.test",
    DDAS_ADMIN_PASSWORD: "admin-password-123",
    LOG_LEVEL: "error",
    RATE_LIMIT_AUTH_LIMIT: "100000",
    RATE_LIMIT_MUTATION_LIMIT: "100000",
    RATE_LIMIT_READ_LIMIT: "100000",
    RATE_LIMIT_ADMIN_LIMIT: "100000",
  });

  async function as(user: string, opts: { method: string; url: string; payload?: unknown; headers?: Record<string, string> }) {
    return app.inject({
      method: opts.method as "GET",
      url: opts.url,
      ...(opts.payload !== undefined ? { payload: opts.payload as string } : {}),
      headers: { ...(opts.headers ?? {}), cookie: cookies[user]! },
    });
  }

  async function login(user: string, email: string, password: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    cookies[user] = (Array.isArray(setCookie) ? setCookie[0] : setCookie)!.split(";")[0]!;
  }

  beforeAll(async () => {
    bucket = `ddas-e2e-${randomBytes(6).toString("hex")}`;
    const client = new S3Client({
      region: "us-east-1",
      endpoint: TEST_S3_ENDPOINT!,
      forcePathStyle: true,
      credentials: S3_CREDS,
    });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    client.destroy();
    bucketStore = await createBlobStore({
      driver: "s3",
      dir: "/unused",
      s3: { endpoint: TEST_S3_ENDPOINT!, region: "us-east-1", bucket, forcePathStyle: true, ...S3_CREDS },
    });

    const fresh = await freshTestDb("s3e2e");
    await fresh.close();
    pool = new pg.Pool({ connectionString: testDatabaseUrlFor("s3e2e") });
    const env = loadEnv(s3Env(bucket));
    app = await buildApp({ pool, env, extractionProvider: labeledFactsProvider(flagship) });
    await bootstrapAdmin(pool, env);
    await app.ready();

    await login("admin", "admin@s3.test", "admin-password-123");
    const requester = await as("admin", {
      method: "POST",
      url: "/api/v1/admin/principals",
      payload: {
        kind: "human",
        name: "Ruben",
        email: "ruben@s3.test",
        password: "ruben-password-123",
        roles: ["requester"],
      },
    });
    expect(requester.statusCode).toBe(200);

    const kolvarraYaml = readFileSync(path.join(CORPUS_DIR, "policy/kolvarra-risk.v1.yaml"), "utf8");
    const draft = await as("admin", {
      method: "POST",
      url: "/api/v1/policies/kolvarra-risk/versions",
      payload: { sourceYaml: kolvarraYaml },
    });
    expect(draft.statusCode).toBe(200);
    const activation = await as("admin", {
      method: "POST",
      url: `/api/v1/policy-versions/${(draft.json() as { id: string }).id}/activate`,
      payload: { overrideReason: "s3 e2e bootstrap" },
    });
    expect(activation.statusCode).toBe(200);
    await login("requester", "ruben@s3.test", "ruben-password-123");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("boot fails fast and clearly when the bucket is unreachable", async () => {
    const badPool = new pg.Pool({ connectionString: testDatabaseUrlFor("s3e2e") });
    try {
      await expect(
        buildApp({
          pool: badPool,
          env: loadEnv(s3Env("ddas-e2e-no-such-bucket")),
          extractionProvider: null,
          withJobs: false,
        })
      ).rejects.toThrow(/S3 blob storage is unreachable/);
    } finally {
      await badPool.end();
    }
  });

  it("round-trips a document: submit → blob in the bucket → extraction → authed text route", async () => {
    const { payload, headers } = multipart(
      { title: "s3 round-trip", policySlug: "kolvarra-risk" },
      caseDocs
    );
    const submitted = await as("requester", {
      method: "POST",
      url: "/api/v1/requests",
      payload,
      headers,
    });
    expect(submitted.statusCode).toBe(200);
    const requestId = (submitted.json() as { id: string }).id;

    // Extraction (which reads the text) completes: the request reaches facts_review.
    const startedAt = Date.now();
    for (;;) {
      const detail = await as("requester", { method: "GET", url: `/api/v1/requests/${requestId}` });
      const body = detail.json() as { state: string; failureReason: string | null };
      if (body.state === "facts_review") break;
      if (body.state === "failed") throw new Error(`request failed: ${body.failureReason}`);
      if (Date.now() - startedAt > 30_000) throw new Error(`still ${body.state}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    // Every submitted document sits in the bucket under its sha256 —
    // the same content-addressed layout the fs driver uses.
    const detail = await as("requester", { method: "GET", url: `/api/v1/requests/${requestId}` });
    const documents = (detail.json() as {
      documents: Array<{ id: string; name: string; sha256: string }>;
    }).documents;
    expect(documents.length).toBe(caseDocs.length);
    for (const doc of documents) {
      const original = caseDocs.find((d) => d.filename === doc.name)!;
      expect(doc.sha256).toBe(createHash("sha256").update(original.content).digest("hex"));
      expect((await bucketStore.get(doc.sha256)).toString("utf8")).toBe(original.content);
    }

    // The blob fetch route works — and only through auth. No presigned URLs,
    // no public objects: without a session the same route is a 401.
    const first = documents[0]!;
    const text = await as("requester", { method: "GET", url: `/api/v1/documents/${first.id}/text` });
    expect(text.statusCode).toBe(200);
    expect((text.json() as { text: string }).text).toBe(
      caseDocs.find((d) => d.filename === first.name)!.content
    );
    const anonymous = await app.inject({ method: "GET", url: `/api/v1/documents/${first.id}/text` });
    expect(anonymous.statusCode).toBe(401);
  }, 60_000);
});
