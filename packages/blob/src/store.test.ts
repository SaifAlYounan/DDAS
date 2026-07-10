/**
 * One contract, two drivers. The fs side always runs; the s3 side runs
 * against any S3-compatible store named by TEST_S3_ENDPOINT (CI/local:
 * a MinIO container) and skips with a notice otherwise — plain `pnpm test`
 * must never require a daemon.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";
import { createBlobStore, type BlobStore } from "./index.js";

const TEST_S3_ENDPOINT = process.env["TEST_S3_ENDPOINT"];
const TEST_S3_ACCESS_KEY_ID = process.env["TEST_S3_ACCESS_KEY_ID"] ?? "test";
const TEST_S3_SECRET_ACCESS_KEY = process.env["TEST_S3_SECRET_ACCESS_KEY"] ?? "testtest123";

if (!TEST_S3_ENDPOINT) {
  // eslint-disable-next-line no-console
  console.warn("skipping s3 blob-driver suite (needs TEST_S3_ENDPOINT, e.g. a MinIO container)");
}

const s3ConfigFor = (bucket: string) => ({
  driver: "s3" as const,
  dir: "/unused",
  s3: {
    endpoint: TEST_S3_ENDPOINT!,
    region: "us-east-1",
    bucket,
    accessKeyId: TEST_S3_ACCESS_KEY_ID,
    secretAccessKey: TEST_S3_SECRET_ACCESS_KEY,
    forcePathStyle: true,
  },
});

async function makeS3Store(): Promise<BlobStore> {
  const bucket = `ddas-blob-test-${randomBytes(6).toString("hex")}`;
  const client = new S3Client({
    region: "us-east-1",
    endpoint: TEST_S3_ENDPOINT!,
    forcePathStyle: true,
    credentials: {
      accessKeyId: TEST_S3_ACCESS_KEY_ID,
      secretAccessKey: TEST_S3_SECRET_ACCESS_KEY,
    },
  });
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  client.destroy();
  return createBlobStore(s3ConfigFor(bucket));
}

function contractSuite(name: string, make: () => Promise<BlobStore>, skip: boolean) {
  describe.skipIf(skip)(`${name} driver contract`, () => {
    let store: BlobStore;
    const key = "a".repeat(64);
    const content = Buffer.from("blob content — contract\n");

    beforeAll(async () => {
      store = await make();
      await store.probe();
    });

    it("put → get round-trips bytes", async () => {
      await store.put(key, content);
      expect((await store.get(key)).equals(content)).toBe(true);
    });

    it("exists answers for present and absent keys", async () => {
      expect(await store.exists(key)).toBe(true);
      expect(await store.exists("b".repeat(64))).toBe(false);
    });

    it("getStream streams the same bytes", async () => {
      const stream = await store.getStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
      expect(Buffer.concat(chunks).equals(content)).toBe(true);
    });

    it("get on a missing key rejects", async () => {
      await expect(store.get("c".repeat(64))).rejects.toThrow();
    });

    it("list yields every stored key", async () => {
      const other = "d".repeat(64);
      await store.put(other, Buffer.from("second"));
      const keys: string[] = [];
      for await (const k of store.list()) keys.push(k);
      expect(keys.sort()).toEqual([key, other].sort());
    });

    it("rejects path-shaped keys — the seam defends itself", async () => {
      await expect(store.put("../escape", content)).rejects.toThrow(/invalid blob key/);
      await expect(store.get("a/b")).rejects.toThrow(/invalid blob key/);
    });
  });
}

contractSuite(
  "fs",
  async () =>
    createBlobStore({ driver: "fs", dir: mkdtempSync(path.join(tmpdir(), "ddas-blob-fs-")) }),
  false
);
contractSuite("s3", makeS3Store, !TEST_S3_ENDPOINT);

describe("fs driver specifics", () => {
  it("list on a directory that does not exist yet yields nothing", async () => {
    const store = await createBlobStore({
      driver: "fs",
      dir: path.join(mkdtempSync(path.join(tmpdir(), "ddas-blob-fs-")), "nested", "never-made"),
    });
    const keys: string[] = [];
    for await (const k of store.list()) keys.push(k);
    expect(keys).toEqual([]);
  });
});

describe.skipIf(!TEST_S3_ENDPOINT)("s3 driver specifics", () => {
  it("probe fails fast and clearly on a missing bucket", async () => {
    const store = await createBlobStore(s3ConfigFor("ddas-blob-test-no-such-bucket"));
    await expect(store.probe()).rejects.toThrow(/S3 blob storage is unreachable/);
  });

  it("probe fails fast on bad credentials", async () => {
    const bad = await createBlobStore({
      driver: "s3",
      dir: "/unused",
      s3: { ...s3ConfigFor("whatever").s3, secretAccessKey: "wrong-secret" },
    });
    await expect(bad.probe()).rejects.toThrow(/S3 blob storage is unreachable/);
  });
});

describe("config validation", () => {
  it("driver=s3 without bucket/creds fails with the env-var names", async () => {
    await expect(createBlobStore({ driver: "s3", dir: "/unused" })).rejects.toThrow(
      /DDAS_S3_BUCKET, DDAS_S3_ACCESS_KEY_ID, DDAS_S3_SECRET_ACCESS_KEY/
    );
  });
});
