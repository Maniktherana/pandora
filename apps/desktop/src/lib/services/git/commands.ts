import { ipcGitHeaderBranchContext } from "@/lib/services/ipc/client";
import { getIpcClient } from "@/lib/services/ipc/lifecycle";
import { useGitStore } from "./store";

const subscribedTargetsByScopeId = new Map<string, string | null>();
const branchContextRequestsByScopeId = new Map<string, Promise<void>>();

function requireClient() {
  const client = getIpcClient();
  if (!client) throw new Error("IPC client not available");
  return client;
}

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

export function gitInitMany(scopeIds: Iterable<string>): void {
  for (const scopeId of scopeIds) {
    gitInit(scopeId);
  }
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

export function gitLoadBranchContext(scopeId: string): void {
  const store = useGitStore.getState();
  const current = store.byScopeId[scopeId];
  if (current?.branchContext || current?.branchContextLoading) return;

  const existingRequest = branchContextRequestsByScopeId.get(scopeId);
  if (existingRequest) return;

  store.setBranchContextLoading(scopeId, true);
  const request = ipcGitHeaderBranchContext(scopeId)
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
