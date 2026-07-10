/**
 * The filesystem driver — the original DDAS blob layout, unchanged:
 * one flat directory, one file per blob, filename = sha256 hex.
 */
import { createReadStream } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { assertValidBlobKey, type BlobStore } from "./store.js";

export class FsBlobStore implements BlobStore {
  readonly driver = "fs" as const;

  constructor(private readonly dir: string) {}

  private blobPath(key: string): string {
    assertValidBlobKey(key);
    return path.join(this.dir, key);
  }

  async probe(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
    } catch (err) {
      throw new Error(
        `blob directory ${this.dir} is not usable: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async put(key: string, content: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.blobPath(key), content);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.blobPath(key));
  }

  async getStream(key: string): Promise<Readable> {
    // Surface a missing blob as a rejected promise (like get), not as a
    // late 'error' event on the stream.
    const file = this.blobPath(key);
    await access(file);
    return createReadStream(file);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.blobPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async *list(): AsyncIterable<string> {
    let entries;
    try {
      entries = await readdir(this.dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return; // no dir = no blobs
      throw err;
    }
    for (const entry of entries) {
      if (entry.isFile()) yield entry.name;
    }
  }
}
