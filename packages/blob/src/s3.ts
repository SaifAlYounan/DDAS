/**
 * The S3-compatible driver: AWS S3, MinIO, Cloudflare R2, Ceph RGW, ...
 * Keys mirror the filesystem layout — flat, key = sha256 hex. Objects are
 * written with the bucket's default (private) ACL; DDAS never sets a public
 * ACL and never mints presigned URLs — blob content only ever leaves through
 * the server's authenticated routes.
 */
import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { assertValidBlobKey, type BlobStore, type S3BlobConfig } from "./store.js";

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.$metadata?.httpStatusCode === 404
  );
}

export class S3BlobStore implements BlobStore {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpointLabel: string;

  constructor(config: S3BlobConfig) {
    this.bucket = config.bucket;
    this.endpointLabel = config.endpoint || "AWS S3";
    this.client = new S3Client({
      // The SDK insists on a region even for region-less stores like MinIO.
      region: config.region || "us-east-1",
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async probe(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      throw new Error(
        `S3 blob storage is unreachable: bucket "${this.bucket}" at ${this.endpointLabel} — ` +
          `${detail}. Check DDAS_S3_ENDPOINT/DDAS_S3_REGION/DDAS_S3_BUCKET and the credentials ` +
          `(and DDAS_S3_FORCE_PATH_STYLE=true for MinIO-style stores).`
      );
    }
  }

  async put(key: string, content: Buffer): Promise<void> {
    assertValidBlobKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: content })
    );
  }

  async get(key: string): Promise<Buffer> {
    assertValidBlobKey(key);
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    return Buffer.from(await object.Body!.transformToByteArray());
  }

  async getStream(key: string): Promise<Readable> {
    assertValidBlobKey(key);
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    return object.Body as Readable;
  }

  async exists(key: string): Promise<boolean> {
    assertValidBlobKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  async *list(): AsyncIterable<string> {
    let continuationToken: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        })
      );
      for (const object of page.Contents ?? []) {
        if (object.Key) yield object.Key;
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }
}
