/**
 * The blob-store seam. DDAS stores document blobs content-addressed
 * (key = the document's sha256 hex); everything that touches a blob —
 * request submission, backup, restore — goes through this interface,
 * never through a filesystem path or an S3 client directly.
 */
import type { Readable } from "node:stream";

export type BlobDriverName = "fs" | "s3";

export interface BlobStore {
  /** Which driver backs this store — for logs and error messages. */
  readonly driver: BlobDriverName;
  /**
   * Fail-fast connectivity/permission probe, run at boot. fs: the blob
   * directory can be created and written; s3: the bucket answers HeadBucket
   * with these credentials. Throws a clear, actionable error otherwise.
   */
  probe(): Promise<void>;
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Stream a blob's content — backup uses this so it never buffers a blob. */
  getStream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  /** Every stored key, for backup. */
  list(): AsyncIterable<string>;
}

/**
 * Keys are sha256 hex in practice, but restore replays whatever a backup
 * tarball contains — so defend the seam itself: no separators, no dot-dirs.
 */
export function assertValidBlobKey(key: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(key) || key === "." || key === "..") {
    throw new Error(`invalid blob key ${JSON.stringify(key)}`);
  }
}

export interface S3BlobConfig {
  /** Empty/undefined = AWS itself; set for MinIO, R2, Ceph, ... */
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style addressing — required by MinIO and most self-hosted stores. */
  forcePathStyle: boolean;
}

export interface BlobStoreConfig {
  driver: BlobDriverName;
  /** fs driver: the blob directory (BLOB_DIR). */
  dir: string;
  /** s3 driver settings; validated only when driver = "s3". */
  s3?: Partial<S3BlobConfig> | undefined;
}

/** Build a store from an explicit config — the single validation point. */
export async function createBlobStore(config: BlobStoreConfig): Promise<BlobStore> {
  if (config.driver === "fs") {
    const { FsBlobStore } = await import("./fs.js");
    return new FsBlobStore(config.dir);
  }
  const s3 = config.s3 ?? {};
  const missing = (["bucket", "accessKeyId", "secretAccessKey"] as const).filter(
    (field) => !s3[field]
  );
  if (missing.length > 0) {
    const names: Record<string, string> = {
      bucket: "DDAS_S3_BUCKET",
      accessKeyId: "DDAS_S3_ACCESS_KEY_ID",
      secretAccessKey: "DDAS_S3_SECRET_ACCESS_KEY",
    };
    throw new Error(
      `blob driver "s3" needs ${missing.map((f) => names[f]).join(", ")} to be set`
    );
  }
  const { S3BlobStore } = await import("./s3.js");
  return new S3BlobStore({
    endpoint: s3.endpoint || undefined,
    region: s3.region || undefined,
    bucket: s3.bucket!,
    accessKeyId: s3.accessKeyId!,
    secretAccessKey: s3.secretAccessKey!,
    forcePathStyle: s3.forcePathStyle ?? false,
  });
}

/**
 * Build a store from raw environment variables — the CLI path.
 * DDAS_BLOB_DRIVER selects fs (default) or s3; opts.dir overrides BLOB_DIR
 * (the CLI's --blob-dir flag).
 */
export async function blobStoreFromEnv(
  env: NodeJS.ProcessEnv,
  opts: { dir?: string | undefined } = {}
): Promise<BlobStore> {
  const driver = env["DDAS_BLOB_DRIVER"] ?? "fs";
  if (driver !== "fs" && driver !== "s3") {
    throw new Error(`DDAS_BLOB_DRIVER must be "fs" or "s3", got ${JSON.stringify(driver)}`);
  }
  return createBlobStore({
    driver,
    dir: opts.dir ?? env["BLOB_DIR"] ?? "/data/blobs",
    s3: {
      endpoint: env["DDAS_S3_ENDPOINT"],
      region: env["DDAS_S3_REGION"],
      bucket: env["DDAS_S3_BUCKET"] ?? "",
      accessKeyId: env["DDAS_S3_ACCESS_KEY_ID"] ?? "",
      secretAccessKey: env["DDAS_S3_SECRET_ACCESS_KEY"] ?? "",
      forcePathStyle: ["1", "true", "yes"].includes(
        (env["DDAS_S3_FORCE_PATH_STYLE"] ?? "").toLowerCase()
      ),
    },
  });
}
