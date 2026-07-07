/**
 * Document loading — Phase 1 accepts .txt/.md only. PDF is deliberately
 * deferred: extracted-text offsets from PDF libraries don't correspond to any
 * stable document bytes, which would poison citation spans. The interface
 * keeps the slot open.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { LoadedDoc } from "./extract.js";

export interface DocumentLoader {
  extensions: string[];
  load(path: string): LoadedDoc;
}

export const textLoader: DocumentLoader = {
  extensions: [".txt", ".md"],
  load(path: string): LoadedDoc {
    const text = readFileSync(path, "utf8");
    return {
      name: basename(path),
      text,
      sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    };
  },
};

export function loadDocument(path: string): LoadedDoc {
  const ext = extname(path).toLowerCase();
  if (!textLoader.extensions.includes(ext)) {
    throw new Error(`unsupported document type '${ext}' — Phase 1 accepts ${textLoader.extensions.join("/")} (PDF lands in Phase 2)`);
  }
  return textLoader.load(path);
}
