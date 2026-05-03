// Owns the diff parse worker lifecycle.
// Dedupes in-flight parse jobs by content key.
// React Query owns caching result

import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { DiffSource } from "@/lib/shared/shared.types";
import { hashDiffText } from "@/lib/shared/hash";

import DiffWorkerUrl from "./diff.worker.ts?worker&url";

export type ParsedDiffResult = {
  diffMetadata: FileDiffMetadata | null;
  parseError: string | null;
};

export type DiffParseInput = {
  workspaceRoot: string;
  relativePath: string;
  source: DiffSource;
  targetBranch: string | null | undefined;
  original: string;
  modified: string;
};

export function parsedDiffQueryKey(
  workspaceRoot: string,
  source: DiffSource,
  relativePath: string,
  targetBranch: string | null | undefined,
  originalHash: string,
  modifiedHash: string,
) {
  return [
    "parsed-diff",
    workspaceRoot,
    source,
    relativePath,
    targetBranch ?? null,
    originalHash,
    modifiedHash,
  ] as const;
}

// --- Worker singleton ---

let _worker: Worker | null = null;
let _workerFailed = false;
let _nextId = 0;

interface Pending {
  resolve: (result: ParsedDiffResult) => void;
  reject: (err: unknown) => void;
}

const _pending = new Map<string, Pending>();

// In-flight dedupe: content key -> Promise<ParsedDiffResult>
const _inFlight = new Map<string, Promise<ParsedDiffResult>>();

function makeContentKey(input: DiffParseInput): string {
  // Include hashes of actual text so keys are content-based, not time-based.
  return [
    input.relativePath,
    input.source,
    input.targetBranch ?? "",
    hashDiffText(input.original),
    hashDiffText(input.modified),
  ].join("\0");
}

function getWorker(): Worker | null {
  if (_workerFailed) return null;
  if (_worker !== null) return _worker;

  try {
    _worker = new Worker(DiffWorkerUrl, { type: "module" });

    _worker.addEventListener("message", (event: MessageEvent) => {
      const { id, diffMetadata, parseError } = event.data as {
        id: string;
        diffMetadata?: FileDiffMetadata | null;
        parseError?: string;
      };
      const pending = _pending.get(id);
      if (!pending) return;
      _pending.delete(id);
      pending.resolve({ diffMetadata: diffMetadata ?? null, parseError: parseError ?? null });
    });

    _worker.addEventListener("error", () => {
      _workerFailed = true;
      _worker = null;
      for (const [, p] of _pending) {
        p.reject(new Error("diff parse worker failed"));
      }
      _pending.clear();
    });
  } catch {
    _workerFailed = true;
    return null;
  }

  return _worker;
}

function parseOnMainThread(input: DiffParseInput): ParsedDiffResult {
  // Fallback — only used when Worker is unavailable or has crashed.
  // Still called asynchronously (via Promise.resolve().then) to stay off render path.
  try {
    const diffMetadata = parseDiffFromFile(
      { name: input.relativePath, contents: input.original },
      { name: input.relativePath, contents: input.modified },
    );
    return { diffMetadata, parseError: null };
  } catch (error) {
    return { diffMetadata: null, parseError: String(error) };
  }
}

export function parseDiffInWorker(input: DiffParseInput): Promise<ParsedDiffResult> {
  const key = makeContentKey(input);

  const existing = _inFlight.get(key);
  if (existing) return existing;

  let raw: Promise<ParsedDiffResult>;
  const w = getWorker();

  if (w === null) {
    // Wrap in a microtask so callers are never synchronous on the render path.
    raw = Promise.resolve().then(() => parseOnMainThread(input));
  } else {
    const id = String(++_nextId);
    raw = new Promise<ParsedDiffResult>((resolve, reject) => {
      _pending.set(id, { resolve, reject });
      w.postMessage({
        id,
        relativePath: input.relativePath,
        original: input.original,
        modified: input.modified,
      });
    });
  }

  // Remove from in-flight map when the promise settles (success or error).
  const tracked = raw.then(
    (result) => {
      _inFlight.delete(key);
      return result;
    },
    (err: unknown) => {
      _inFlight.delete(key);
      throw err;
    },
  );

  _inFlight.set(key, tracked);
  return tracked;
}

// Convenience wrapper for ReviewViewer prewarming — callers must .catch() the returned promise.
export function prefetchParsedDiff(input: DiffParseInput): Promise<void> {
  return parseDiffInWorker(input).then(() => undefined);
}
