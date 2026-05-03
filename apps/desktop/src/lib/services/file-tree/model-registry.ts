import {
  FileTree,
  type FileTreeBatchOperation,
  type FileTreeDropResult,
  type FileTreeOptions,
  type FileTreeRenameEvent,
} from "@pierre/trees";
import type { FileTreeEntry, FileTreeSnapshot } from "@/lib/shared/shared.types";
import { setIgnoredEntries } from "./decorations";
import { useFileTreeStore } from "./store";

const models = new Map<string, FileTree>();
const cache = new Map<string, CachedFileTreeModel>();
const modelVersions = new WeakMap<FileTree, number>();
const runtimes = new Map<string, FileTreeModelRuntime>();
let nextVersion = 1;

interface CachedFileTreeModel {
  paths: string[];
  directoryPaths: string[];
  pathSet: Set<string>;
  version: number;
}

export interface FileTreeModelRuntime {
  onSelectionChange: (selectedPaths: readonly string[]) => void;
  onRename: (event: FileTreeRenameEvent) => void;
  onDropComplete: (event: FileTreeDropResult) => void;
}

type FileTreeModelOptions = Omit<
  FileTreeOptions,
  | "dragAndDrop"
  | "gitStatus"
  | "initialSelectedPaths"
  | "onSelectionChange"
  | "paths"
  | "preparedInput"
  | "renaming"
>;

export function setFileTreeModelRuntime(scopeId: string, runtime: FileTreeModelRuntime): void {
  runtimes.set(scopeId, runtime);
}

export function clearFileTreeModelRuntime(scopeId: string, runtime: FileTreeModelRuntime): void {
  if (runtimes.get(scopeId) === runtime) runtimes.delete(scopeId);
}

export function getOrCreateFileTreeModel(
  scopeId: string,
  options: FileTreeModelOptions,
  initialSelectedPath: string | null,
): FileTree {
  const existing = models.get(scopeId);
  if (existing) return existing;

  const cached = cache.get(scopeId);
  const initialPaths = isValidCache(cached) ? cached.paths : [];
  const model = new FileTree({
    ...options,
    paths: initialPaths,
    ...(initialSelectedPath ? { initialSelectedPaths: [initialSelectedPath] } : {}),
    gitStatus: [],
    onSelectionChange: (selectedPaths) => {
      runtimes.get(scopeId)?.onSelectionChange(selectedPaths);
    },
    renaming: {
      onRename: (event) => {
        runtimes.get(scopeId)?.onRename(event);
      },
    },
    dragAndDrop: {
      onDropComplete: (event) => {
        runtimes.get(scopeId)?.onDropComplete(event);
      },
    },
  });

  models.set(scopeId, model);
  if (isValidCache(cached)) modelVersions.set(model, cached.version);
  return model;
}

export function scheduleSnapshot(scopeId: string, snapshot: FileTreeSnapshot): void {
  if (!Array.isArray(snapshot.paths) || !Array.isArray(snapshot.directoryPaths) || snapshot.paths.length === 0) {
    cache.delete(scopeId);
    useFileTreeStore.getState().setError(scopeId, "invalid file tree snapshot");
    console.error("Invalid file tree snapshot:", snapshot);
    return;
  }

  const paths = snapshot.paths;
  const cached: CachedFileTreeModel = {
    paths,
    directoryPaths: snapshot.directoryPaths,
    pathSet: new Set(paths),
    version: nextVersion++,
  };
  cache.set(scopeId, cached);
  setIgnoredEntries(scopeId, []);
  applyCacheToModel(scopeId, models.get(scopeId));
  useFileTreeStore.getState().setBooted(scopeId);
}

export function scheduleDirectoryChanged(
  scopeId: string,
  parentPath: string,
  entries: FileTreeEntry[],
): void {
  const cached = cache.get(scopeId);
  if (!cached) return;

  const operations = applyDirectoryChangeToCache(cached, parentPath, entries);
  rebuildPreparedCache(cached);

  const model = models.get(scopeId);
  if (model && operations.length > 0) {
    model.batch(operations);
    modelVersions.set(model, cached.version);
  }
  useFileTreeStore.getState().setBooted(scopeId);
}

export function getInitialPaths(scopeId: string): string[] {
  const cached = cache.get(scopeId);
  return isValidCache(cached) ? cached.paths : [];
}

export function getCachedDirectoryPaths(scopeId: string): string[] {
  const cached = cache.get(scopeId);
  return isValidCache(cached) ? cached.directoryPaths : [];
}

export function hasCachedFileTree(scopeId: string): boolean {
  return isValidCache(cache.get(scopeId));
}

function applyCacheToModel(scopeId: string, model: FileTree | undefined): void {
  if (!model) return;
  const cached = cache.get(scopeId);
  if (!isValidCache(cached)) return;
  if (modelVersions.get(model) === cached.version) return;

  model.resetPaths(cached.paths);
  modelVersions.set(model, cached.version);
}

function isValidCache(cached: CachedFileTreeModel | undefined): cached is CachedFileTreeModel {
  return Array.isArray(cached?.paths) && cached.paths.length > 0 && Array.isArray(cached.directoryPaths);
}

function applyDirectoryChangeToCache(
  cached: CachedFileTreeModel,
  parentPath: string,
  entries: FileTreeEntry[],
): FileTreeBatchOperation[] {
  const oldPaths = getDirectChildPaths(cached.pathSet, parentPath);
  const nextPaths = new Set(entries.map((entry) => entryPath(parentPath, entry)));
  const operations: FileTreeBatchOperation[] = [];

  for (const path of oldPaths) {
    if (nextPaths.has(path)) continue;
    if (path.endsWith("/")) {
      removePathPrefix(cached, path);
      operations.push({ type: "remove", path, recursive: true });
    } else if (cached.pathSet.delete(path)) {
      operations.push({ type: "remove", path });
    }
  }

  for (const path of nextPaths) {
    if (cached.pathSet.has(path)) continue;
    cached.pathSet.add(path);
    operations.push({ type: "add", path });
  }

  return operations;
}

function rebuildPreparedCache(cached: CachedFileTreeModel): void {
  cached.paths = Array.from(cached.pathSet).sort(compareFileTreePaths);
  cached.directoryPaths = cached.paths.filter((path) => path.endsWith("/"));
  cached.version = nextVersion++;
}

function getDirectChildPaths(pathSet: Set<string>, parentPath: string): Set<string> {
  const result = new Set<string>();
  const normalizedParent = parentPath.endsWith("/") ? parentPath.slice(0, -1) : parentPath;
  for (const path of pathSet) {
    if (parentOf(path) === normalizedParent) result.add(path);
  }
  return result;
}

function parentOf(path: string): string {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const lastSlash = trimmed.lastIndexOf("/");
  return lastSlash < 0 ? "" : trimmed.slice(0, lastSlash);
}

function entryPath(parentPath: string, entry: FileTreeEntry): string {
  const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
  return entry.isDirectory ? `${fullPath}/` : fullPath;
}

function removePathPrefix(cached: CachedFileTreeModel, prefix: string): void {
  for (const path of Array.from(cached.pathSet)) {
    if (path === prefix || path.startsWith(prefix)) cached.pathSet.delete(path);
  }
}

function compareFileTreePaths(a: string, b: string): number {
  const aParent = parentOf(a);
  const bParent = parentOf(b);
  if (aParent === bParent && a.endsWith("/") !== b.endsWith("/")) {
    return a.endsWith("/") ? -1 : 1;
  }

  const aSegments = a.replace(/\/$/, "").split("/");
  const bSegments = b.replace(/\/$/, "").split("/");
  const max = Math.min(aSegments.length, bSegments.length);
  for (let i = 0; i < max; i += 1) {
    const byLower = aSegments[i].toLowerCase().localeCompare(bSegments[i].toLowerCase());
    if (byLower !== 0) return byLower;
    const byExact = aSegments[i].localeCompare(bSegments[i]);
    if (byExact !== 0) return byExact;
  }
  return aSegments.length - bSegments.length || a.localeCompare(b);
}
