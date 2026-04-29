import { getIpcClient } from "@/services/ipc/ipc-lifecycle";
import { useGitStore } from "./git-store";
import { gitHeaderBranchContext } from "@/services/git/git-api";

const subscribedTargetsByScopeId = new Map<string, string | null>();
const branchContextRequestsByScopeId = new Map<string, Promise<void>>();

export function gitInit(scopeId: string): void {
  const currentTargetBranch =
    useGitStore.getState().byScopeId[scopeId]?.snapshot?.targetBranch ?? null;
  const currentSnapshot = useGitStore.getState().byScopeId[scopeId]?.snapshot ?? null;
  if (
    currentSnapshot &&
    subscribedTargetsByScopeId.get(scopeId) === currentTargetBranch
  ) {
    return;
  }
  const client = getIpcClient();
  if (!client) return;
  subscribedTargetsByScopeId.set(scopeId, currentTargetBranch);
  client.gitSubscribe(scopeId, currentTargetBranch).catch(() => {
    subscribedTargetsByScopeId.delete(scopeId);
  });
}

export function gitRefresh(scopeId: string): void {
  const client = getIpcClient();
  if (!client) return;
  client.gitRefresh(scopeId).catch(console.error);
}

export function gitStage(scopeId: string, paths: string[]): void {
  if (paths.length > 0) useGitStore.getState().markPending(scopeId, paths);
  const client = getIpcClient();
  if (!client) return;
  client.gitStage(scopeId, paths).catch(console.error);
}

export function gitStageAll(scopeId: string): void {
  const unstaged = useGitStore.getState().byScopeId[scopeId]?.unstagedEntries;
  if (unstaged && unstaged.length > 0) {
    useGitStore.getState().markPending(scopeId, unstaged.map((e) => e.path));
  }
  const client = getIpcClient();
  if (!client) return;
  client.gitStageAll(scopeId).catch(console.error);
}

export function gitUnstage(scopeId: string, paths: string[]): void {
  if (paths.length > 0) useGitStore.getState().markPending(scopeId, paths);
  const client = getIpcClient();
  if (!client) return;
  client.gitUnstage(scopeId, paths).catch(console.error);
}

export function gitUnstageAll(scopeId: string): void {
  const staged = useGitStore.getState().byScopeId[scopeId]?.stagedEntries;
  if (staged && staged.length > 0) {
    useGitStore.getState().markPending(scopeId, staged.map((e) => e.path));
  }
  const client = getIpcClient();
  if (!client) return;
  client.gitUnstageAll(scopeId).catch(console.error);
}

export function gitDiscardTracked(scopeId: string, paths: string[]): void {
  const client = getIpcClient();
  if (!client) return;
  client.gitDiscardTracked(scopeId, paths).catch(console.error);
}

export function gitDiscardUntracked(scopeId: string, paths: string[]): void {
  const client = getIpcClient();
  if (!client) return;
  client.gitDiscardUntracked(scopeId, paths).catch(console.error);
}

export function gitCommit(scopeId: string, message: string, push = false): void {
  const client = getIpcClient();
  if (!client) return;
  client.gitCommit(scopeId, message, push).catch(console.error);
}

export function gitPush(scopeId: string): void {
  const client = getIpcClient();
  if (!client) return;
  client.gitPush(scopeId).catch(console.error);
}

export function gitFetch(scopeId: string): void {
  const client = getIpcClient();
  if (!client) return;
  client.gitFetch(scopeId).catch(console.error);
}

export function gitPull(scopeId: string): void {
  const client = getIpcClient();
  if (!client) return;
  client.gitPull(scopeId).catch(console.error);
}

export function gitSetTargetBranch(scopeId: string, branch: string | null): void {
  subscribedTargetsByScopeId.set(scopeId, branch);
  const client = getIpcClient();
  if (!client) return;
  client.gitSetTargetBranch(scopeId, branch).catch(console.error);
}

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
      useGitStore.getState().setError(scopeId, String(error));
    })
    .finally(() => {
      branchContextRequestsByScopeId.delete(scopeId);
    });

  branchContextRequestsByScopeId.set(scopeId, request);
}
