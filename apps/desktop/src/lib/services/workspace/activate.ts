import { ensureFileTree } from "@/lib/services/file-tree/subscribe";
import type { WorkspaceRecord } from "@/lib/shared/shared.types";
import { gitInit } from "@/lib/services/git/commands";
import { continueWorkspaceStartupAfterFileTree } from "@/lib/services/workspace/startup";
import { useCatalogStore } from "@/lib/services/catalog/store";
import { useNavigationStore } from "@/lib/services/navigation/store";

function getReadySelectedWorkspace(workspaceId: string): WorkspaceRecord | null {
  const workspace = useCatalogStore.getState().workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace || workspace.status !== "ready") return null;
  if (useNavigationStore.getState().selectedWorkspaceID !== workspace.id) return null;
  return workspace;
}

export async function startSelectedWorkspaceBackgroundStartup(
  workspaceId: string,
): Promise<void> {
  const workspace = getReadySelectedWorkspace(workspaceId);
  if (!workspace) return;

  ensureFileTree(workspace.id);
  gitInit(workspace.id);

  await continueWorkspaceStartupAfterFileTree(workspace);
}
