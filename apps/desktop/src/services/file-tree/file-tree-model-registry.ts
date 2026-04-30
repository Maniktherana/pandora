import type { FileTree, FileTreeBatchOperation, GitStatusEntry } from "@pierre/trees";
import type { FileTreeEntry } from "@/lib/shared/types";

const models = new Map<string, FileTree>();
const dirs = new Map<string, Record<string, FileTreeEntry[]>>();
const pathCache = new Map<string, Set<string>>();

export function registerModel(scopeId: string, model: FileTree): void {
  models.set(scopeId, model);
  const d = dirs.get(scopeId);
  if (d) {
    const paths = extractPaths(d);
    pathCache.set(scopeId, new Set(paths));
    model.resetPaths(paths);
    model.setGitStatus(extractIgnored(d));
  }
}

export function unregisterModel(scopeId: string): void {
  models.delete(scopeId);
}

export function applySnapshot(
  scopeId: string,
  directories: Record<string, FileTreeEntry[]>,
): void {
  const hadPrevious = dirs.has(scopeId);
  dirs.set(scopeId, directories);
  const model = models.get(scopeId);
  if (!model) return;

  const nextPaths = extractPaths(directories);
  if (hadPrevious) {
    applyDiff(scopeId, model, nextPaths);
  } else {
    pathCache.set(scopeId, new Set(nextPaths));
    model.resetPaths(nextPaths);
  }
  model.setGitStatus(extractIgnored(directories));
}

export function applyDirectoryChanged(
  scopeId: string,
  path: string,
  entries: FileTreeEntry[],
): void {
  const d = dirs.get(scopeId);
  if (!d) return;
  dirs.set(scopeId, { ...d, [path]: entries });
  const model = models.get(scopeId);
  if (!model) return;
  const nextPaths = extractPaths(dirs.get(scopeId)!);
  applyDiff(scopeId, model, nextPaths);
  model.setGitStatus(extractIgnored(dirs.get(scopeId)!));
}

function applyDiff(scopeId: string, model: FileTree, nextPaths: string[]): void {
  const prev = pathCache.get(scopeId) ?? new Set<string>();
  const next = new Set(nextPaths);

  const ops: FileTreeBatchOperation[] = [];
  for (const p of next) {
    if (!prev.has(p)) ops.push({ type: "add", path: p });
  }
  for (const p of prev) {
    if (!next.has(p)) ops.push({ type: "remove", path: p });
  }

  pathCache.set(scopeId, next);

  if (ops.length > 0) {
    model.batch(ops);
  }
}

export function getInitialPaths(scopeId: string): string[] {
  const d = dirs.get(scopeId);
  return d ? extractPaths(d) : [];
}

export function getInitialIgnored(scopeId: string): GitStatusEntry[] {
  const d = dirs.get(scopeId);
  return d ? extractIgnored(d) : [];
}

export function getDirectories(scopeId: string): Record<string, FileTreeEntry[]> | undefined {
  return dirs.get(scopeId);
}

export function extractPaths(directories: Record<string, FileTreeEntry[]>): string[] {
  const paths: string[] = [];
  const walk = (parentPath: string) => {
    const entries = directories[parentPath];
    if (!entries) return;
    for (const entry of entries) {
      const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        paths.push(`${fullPath}/`);
        walk(fullPath);
      } else {
        paths.push(fullPath);
      }
    }
  };
  walk("");
  return paths;
}

function extractIgnored(directories: Record<string, FileTreeEntry[]>): GitStatusEntry[] {
  const result: GitStatusEntry[] = [];
  const walk = (parentPath: string) => {
    const entries = directories[parentPath];
    if (!entries) return;
    for (const entry of entries) {
      const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      if (entry.isIgnored) {
        result.push({ path: entry.isDirectory ? `${fullPath}/` : fullPath, status: "ignored" });
      }
      if (entry.isDirectory) walk(fullPath);
    }
  };
  walk("");
  return result;
}
