import type { AppState, WorkspaceRecord } from "@/lib/shared/shared.types";
import { useCatalogStore } from "@/lib/services/catalog/store";
import { useNavigationStore } from "@/lib/services/navigation/store";

// ─── workspace record helpers ─────────────────────────────────────────────────

export function patchWorkspaceRecord(record: WorkspaceRecord) {
  useCatalogStore.getState().patchWorkspace(structuredClone(record));
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
