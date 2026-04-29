import type { AppState, WorkspaceRecord } from "@/lib/shared/types";
import { useCatalogStore } from "@/services/workspace/catalog-store";
import { useNavigationStore } from "@/services/workspace/navigation-store";

// ─── workspace record helpers ─────────────────────────────────────────────────

export function compareCreatedAtDesc<T extends { createdAt: string }>(a: T, b: T) {
  return b.createdAt.localeCompare(a.createdAt);
}

export function replaceWorkspaceRecord(
  workspaces: WorkspaceRecord[],
  workspaceId: string,
  mutate: (workspace: WorkspaceRecord) => void,
) {
  let changed = false;
  const nextWorkspaces = workspaces.map((workspace) => {
    if (workspace.id !== workspaceId) return workspace;
    changed = true;
    const nextWorkspace = structuredClone(workspace);
    mutate(nextWorkspace);
    return nextWorkspace;
  });
  return changed ? nextWorkspaces.sort(compareCreatedAtDesc) : workspaces;
}

export function patchWorkspaceRecord(record: WorkspaceRecord) {
  useCatalogStore.getState().patchWorkspace(structuredClone(record));
}

export function getVisibleSidebarWorkspaces() {
  const { projects, workspaces } = useCatalogStore.getState();
  return projects.flatMap((project) =>
    workspaces.filter(
      (workspace) =>
        workspace.projectId === project.id && workspace.status !== "archived",
    ),
  );
}

// ─── app state application ────────────────────────────────────────────────────

export function applyAppState(appState: AppState): { allowedScopeIds: Set<string> } {
  useCatalogStore.getState().applyAppState(
    structuredClone(appState.projects),
    structuredClone(appState.workspaces),
  );
  if (appState.selectedWorkspaceId) {
    const ws = appState.workspaces.find((w) => w.id === appState.selectedWorkspaceId);
    if (ws) {
      useNavigationStore.getState().selectWorkspace(ws.id, ws.projectId);
    }
  } else if (appState.selectedProjectId) {
    useNavigationStore.getState().selectProject(appState.selectedProjectId);
  }

  const allowedScopeIds = new Set<string>(appState.workspaces.map((w) => w.id));
  for (const project of appState.projects) allowedScopeIds.add(`project:${project.id}`);

  return { allowedScopeIds };
}
