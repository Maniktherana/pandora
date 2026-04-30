import type { FileTree, GitStatusEntry } from "@pierre/trees";
import type { ScmEntry } from "@/lib/shared/types";
import { statusTone } from "@/services/git/git-utils";
import type { TreeGitTone } from "@/services/git/git-types";

function toneToGitStatus(tone: TreeGitTone): GitStatusEntry["status"] | null {
  switch (tone) {
    case "added": return "added";
    case "modified": return "modified";
    case "deleted": return "deleted";
    case "renamed": return "renamed";
    case "ignored": return "ignored";
    case "conflict": return "modified";
    default: return null;
  }
}

function scmToGitStatus(entries: readonly ScmEntry[]): GitStatusEntry[] {
  const result: GitStatusEntry[] = [];
  for (const entry of entries) {
    const tone = statusTone(entry);
    const status = toneToGitStatus(tone);
    if (status) result.push({ path: entry.path, status });
    else if (entry.untracked) result.push({ path: entry.path, status: "untracked" });
  }
  return result;
}

// ── per-workspace state ──────────────────────────────────────────────────────

interface WorkspaceDecorationState {
  model: FileTree | null;
  ignored: GitStatusEntry[];
  scm: GitStatusEntry[];
}

const state = new Map<string, WorkspaceDecorationState>();

function getOrCreate(scopeId: string): WorkspaceDecorationState {
  let s = state.get(scopeId);
  if (!s) {
    s = { model: null, ignored: [], scm: [] };
    state.set(scopeId, s);
  }
  return s;
}

function applyMerged(s: WorkspaceDecorationState): void {
  if (!s.model) return;

  // SCM paths take priority over ignored paths.
  const scmPaths = new Set(s.scm.map((e) => e.path));
  const merged: GitStatusEntry[] = [
    ...s.ignored.filter((e) => !scmPaths.has(e.path)),
    ...s.scm,
  ];
  s.model.setGitStatus(merged);
}

// ── public API ───────────────────────────────────────────────────────────────

export function registerDecorationModel(scopeId: string, model: FileTree): void {
  const s = getOrCreate(scopeId);
  s.model = model;
  applyMerged(s);
}

export function unregisterDecorationModel(scopeId: string): void {
  const s = state.get(scopeId);
  if (s) s.model = null;
}

/** Called by file-tree-model-registry when ignored paths change. */
export function setIgnoredEntries(scopeId: string, ignored: GitStatusEntry[]): void {
  const s = getOrCreate(scopeId);
  s.ignored = ignored;
  applyMerged(s);
}

/** Called by git-events when an SCM snapshot arrives. */
export function setScmEntries(scopeId: string, entries: readonly ScmEntry[]): void {
  const s = getOrCreate(scopeId);
  s.scm = scmToGitStatus(entries);
  applyMerged(s);
}

/** Initial ignored entries for useFileTree({ gitStatus }). */
export function getInitialMergedStatus(scopeId: string): GitStatusEntry[] {
  const s = state.get(scopeId);
  if (!s) return [];
  const scmPaths = new Set(s.scm.map((e) => e.path));
  return [
    ...s.ignored.filter((e) => !scmPaths.has(e.path)),
    ...s.scm,
  ];
}
