import { loadFileTreeExpandedPaths } from "@/lib/services/preferences/file-tree";
import { useFileTreeStore } from "@/lib/services/file-tree/store";
import { getIpcClient } from "@/lib/services/ipc/lifecycle";

const subscribedWorkspaceIds = new Set<string>();
const subscriptionVersions = new Map<string, number>();

function nextSubscriptionVersion(workspaceId: string): number {
  const version = (subscriptionVersions.get(workspaceId) ?? 0) + 1;
  subscriptionVersions.set(workspaceId, version);
  return version;
}

function isCurrentSubscription(workspaceId: string, version: number): boolean {
  return (
    subscribedWorkspaceIds.has(workspaceId) &&
    subscriptionVersions.get(workspaceId) === version
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ensureFileTree(workspaceId: string): void {
  const current = useFileTreeStore.getState().byScopeId[workspaceId];
  if (subscribedWorkspaceIds.has(workspaceId)) {
    if (current?.bootStatus === "loading" || current?.bootStatus === "loaded") return;
  }

  useFileTreeStore.getState().setBootLoading(workspaceId);

  const client = getIpcClient();
  if (!client) return;

  const version = nextSubscriptionVersion(workspaceId);
  subscribedWorkspaceIds.add(workspaceId);

  client.fileTreeSubscribe(workspaceId, []).catch((error) => {
    if (!isCurrentSubscription(workspaceId, version)) return;
    subscribedWorkspaceIds.delete(workspaceId);
    useFileTreeStore.getState().setError(workspaceId, errorMessage(error));
  });

  loadFileTreeExpandedPaths(workspaceId)
    .then((paths) => {
      if (!isCurrentSubscription(workspaceId, version)) return;
      const latestClient = getIpcClient();
      if (!latestClient) return;
      latestClient.fileTreeSetExpandedPaths(workspaceId, paths).catch((error) => {
        console.warn(
          `Failed to restore expanded file tree paths for workspace ${workspaceId}:`,
          error,
        );
      });
    })
    .catch((error) => {
      console.warn(
        `Failed to load expanded file tree paths for workspace ${workspaceId}:`,
        error,
      );
    });
}
