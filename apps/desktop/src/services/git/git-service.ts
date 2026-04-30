import { getIpcClient } from "@/services/ipc/ipc-lifecycle";
import { useGitStore } from "./git-store";
import { gitHeaderBranchContext } from "@/services/git/git-api";

/**
 * Tracks which workspace scopes currently have an active backend git
 * subscription, keyed by scopeId. A scope is present here once gitSubscribe
 * has been sent and the promise has not yet rejected.
 */
const subscribedTargetsByScopeId = new Map<string, string | null>();

const branchContextRequestsByScopeId = new Map<string, Promise<void>>();

/**
 * Resolve the IPC client or throw so action callers always get a rejected
 * promise rather than a silent no-op.
 */
function requireClient() {
  const client = getIpcClient();
  if (!client) throw new Error("IPC client not available");
  return client;
}

/**
 * Ensure the backend git subscription for `scopeId` is started.
 *
 * Returns `true` when a new subscription was sent (a scm_snapshot event will
 * arrive shortly), or `false` when the subscription was already active (no
 * automatic event will be sent). Callers that need a guaranteed fresh snapshot
 * should call `gitRefresh` when this returns `false`.
 */
export function gitInit(scopeId: string): boolean {
  if (subscribedTargetsByScopeId.has(scopeId)) return false;

  const client = getIpcClient();
  if (!client) return false;

  subscribedTargetsByScopeId.set(scopeId, null);
  client.gitSubscribe(scopeId, null).catch(() => {
    subscribedTargetsByScopeId.delete(scopeId);
  });
  return true;
}

export function gitRefresh(scopeId: string): Promise<void> {
  return requireClient().gitRefresh(scopeId);
}

export function gitStage(scopeId: string, paths: string[]): Promise<void> {
  return requireClient().gitStage(scopeId, paths);
}

export function gitStageAll(scopeId: string): Promise<void> {
  return requireClient().gitStageAll(scopeId);
}

export function gitUnstage(scopeId: string, paths: string[]): Promise<void> {
  return requireClient().gitUnstage(scopeId, paths);
}

export function gitUnstageAll(scopeId: string): Promise<void> {
  return requireClient().gitUnstageAll(scopeId);
}

export function gitDiscardTracked(scopeId: string, paths: string[]): Promise<void> {
  return requireClient().gitDiscardTracked(scopeId, paths);
}

export function gitDiscardUntracked(scopeId: string, paths: string[]): Promise<void> {
  return requireClient().gitDiscardUntracked(scopeId, paths);
}

export function gitCommit(scopeId: string, message: string, push = false): Promise<void> {
  return requireClient().gitCommit(scopeId, message, push);
}

export function gitPush(scopeId: string): Promise<void> {
  return requireClient().gitPush(scopeId);
}

export function gitFetch(scopeId: string): Promise<void> {
  return requireClient().gitFetch(scopeId);
}

export function gitPull(scopeId: string): Promise<void> {
  return requireClient().gitPull(scopeId);
}

export function gitSetTargetBranch(scopeId: string, branch: string | null): Promise<void> {
  subscribedTargetsByScopeId.set(scopeId, branch);
  return requireClient().gitSetTargetBranch(scopeId, branch);
}

/**
 * Load branch context for the branch picker.
 * Self-managing (deduplicates in-flight requests); intentionally stays void.
 */
export function gitLoadBranchContext(scopeId: string): void {
  const store = useGitStore.getState();
  const current = store.byScopeId[scopeId];
  if (current?.branchContext || current?.branchContextLoading) return;

  const existingRequest = branchContextRequestsByScopeId.get(scopeId);
  if (existingRequest) return;

  store.setBranchContextLoading(scopeId, true);
  const request = gitHeaderBranchContext(scopeId)
    .then((context) => {
      useGitStore.getState().setBranchContext(scopeId, context);
    })
    .catch((error) => {
      useGitStore.getState().setBranchContextLoading(scopeId, false);
      console.error(`Failed to load branch context for ${scopeId}:`, error);
    })
    .finally(() => {
      branchContextRequestsByScopeId.delete(scopeId);
    });

  branchContextRequestsByScopeId.set(scopeId, request);
}
