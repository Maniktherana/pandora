import { runtimeGateway } from "@/services/runtime/runtime-gateway";
import { useScmStore } from "./scm-store";

const subscribedTargetsByRuntimeId = new Map<string, string | null>();

export function scmInit(runtimeId: string): void {
  const currentTargetBranch =
    useScmStore.getState().byRuntimeId[runtimeId]?.snapshot?.targetBranch ?? null;
  const currentSnapshot = useScmStore.getState().byRuntimeId[runtimeId]?.snapshot ?? null;
  if (
    currentSnapshot &&
    subscribedTargetsByRuntimeId.get(runtimeId) === currentTargetBranch
  ) {
    return;
  }
  const client = runtimeGateway.getClient();
  if (!client) return;
  subscribedTargetsByRuntimeId.set(runtimeId, currentTargetBranch);
  void client.scmSubscribe(runtimeId, currentTargetBranch).catch(() => {
    subscribedTargetsByRuntimeId.delete(runtimeId);
  });
}

export function scmRefresh(runtimeId: string): void {
  void runtimeGateway.getClient()?.scmRefresh(runtimeId);
}

export function scmStage(runtimeId: string, paths: string[]): void {
  void runtimeGateway.getClient()?.scmStage(runtimeId, paths);
}

export function scmStageAll(runtimeId: string): void {
  void runtimeGateway.getClient()?.scmStageAll(runtimeId);
}

export function scmUnstage(runtimeId: string, paths: string[]): void {
  void runtimeGateway.getClient()?.scmUnstage(runtimeId, paths);
}

export function scmUnstageAll(runtimeId: string): void {
  void runtimeGateway.getClient()?.scmUnstageAll(runtimeId);
}

export function scmDiscardTracked(runtimeId: string, paths: string[]): void {
  void runtimeGateway.getClient()?.scmDiscardTracked(runtimeId, paths);
}

export function scmDiscardUntracked(runtimeId: string, paths: string[]): void {
  void runtimeGateway.getClient()?.scmDiscardUntracked(runtimeId, paths);
}

export function scmCommit(runtimeId: string, message: string, push = false): void {
  void runtimeGateway.getClient()?.scmCommit(runtimeId, message, push);
}

export function scmPush(runtimeId: string): void {
  void runtimeGateway.getClient()?.scmPush(runtimeId);
}

export function scmFetch(runtimeId: string): void {
  void runtimeGateway.getClient()?.scmFetch(runtimeId);
}

export function scmPull(runtimeId: string): void {
  void runtimeGateway.getClient()?.scmPull(runtimeId);
}

export function scmSetTargetBranch(runtimeId: string, branch: string | null): void {
  subscribedTargetsByRuntimeId.set(runtimeId, branch);
  void runtimeGateway.getClient()?.scmSetTargetBranch(runtimeId, branch);
}
