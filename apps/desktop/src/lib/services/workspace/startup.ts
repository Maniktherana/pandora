import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceRecord } from "@/lib/shared/shared.types";
import { getIpcClient } from "@/lib/services/ipc/lifecycle";
import { useTerminalScopeStore } from "@/lib/services/terminal/store";
import {
  createTerminalStartupService,
} from "@/lib/services/terminal/startup";
import { isProjectTerminalKey, projectTerminalKey } from "@/lib/services/terminal/project-key";
import {
  acknowledgeSelectedTerminalAgentStatus,
} from "@/lib/shared/terminal/agent-activity";
import {
  getWorkspaceSession,
} from "@/lib/services/layout/session";
import {
  persistWorkspaceLayout,
} from "@/lib/services/workspace/persistence";
import { loadPersistedProjectTerminalPanel } from "@/lib/services/preferences/project-terminal";
import { useNavigationStore } from "@/lib/services/navigation/store";
import { useCatalogStore } from "@/lib/services/catalog/store";
import { useLayoutStore } from "@/lib/services/layout/store";
import { LayoutLoadError } from "@/lib/services/errors";
import { createLeaf } from "@/lib/shared/utils";
import { migratePersistedLayout } from "@/lib/services/workspace/layout-migrate";
import { createEmptyTerminalPanel } from "@/lib/shared/terminal/panel";
import { reconcileProjectTerminalPanelState } from "@/lib/services/terminal/project-panel";
import { ensureWorkspaceTerminalLayout } from "@/lib/services/layout/actions";

// ─── terminal startup ─────────────────────────────────────────────────────────

let activeTerminalStartupRefreshQueued = false;

export function scheduleActiveTerminalStartupRefresh(): void {
  if (activeTerminalStartupRefreshQueued) return;
  activeTerminalStartupRefreshQueued = true;
  queueMicrotask(() => {
    activeTerminalStartupRefreshQueued = false;
    terminalStartup
      .refreshActiveScopeTerminalStartup({ rebuildHiddenQueues: true })
      .catch((err) => console.warn("Failed to refresh terminal startup state:", err));
  });
}

export const terminalStartup = createTerminalStartupService({
  getSelectedWorkspaceId: () => useNavigationStore.getState().selectedWorkspaceID,
  getSelectedProjectId: () => useNavigationStore.getState().selectedProjectID,
  getWorkspaceRecord: (workspaceId) =>
    useCatalogStore.getState().workspaces.find((w) => w.id === workspaceId),
  scheduleTerminalStartupRefresh: scheduleActiveTerminalStartupRefresh,
});

// ─── workspace layout helpers ─────────────────────────────────────────────────

export function updateWorkspaceLayout(
  workspaceId: string,
  mutate: () => boolean | void,
): void {
  mutate();
  persistWorkspaceLayout(workspaceId).catch((error) =>
    console.warn("Failed to persist workspace layout:", error),
  );
  terminalStartup
    .refreshScopeTerminalStartup(workspaceId, { rebuildHiddenQueue: true })
    .catch((error) => console.warn("Failed to refresh scope terminal startup:", error));
}

export function mutateWorkspaceLayout<T>(workspaceId: string, mutate: () => T): T {
  const result = mutate();
  persistWorkspaceLayout(workspaceId).catch((error) =>
    console.warn("Failed to persist workspace layout:", error),
  );
  return result;
}

// ─── workspace layout state ───────────────────────────────────────────────────

export function resetWorkspaceLayoutState(workspaceId: string): void {
  const currentLayout = useLayoutStore.getState().getLayout(workspaceId);
  useLayoutStore.getState().setLayout(workspaceId, {
    layoutLoading: false,
    layoutLoaded: currentLayout.root !== null ? currentLayout.layoutLoaded : false,
  });
}

// ─── project terminal scope init ─────────────────────────────────────────────

function ensureProjectTerminalScopeStarted(workspace: WorkspaceRecord): void {
  const projects = useCatalogStore.getState().projects;
  const project = projects.find((p) => p.id === workspace.projectId);
  if (!project || workspace.status !== "ready") return;

  const pk = projectTerminalKey(workspace.projectId);
  const existingLayout = useLayoutStore.getState().byWorkspaceId[pk];
  if (existingLayout) return;

  const placeholder = createLeaf([]);
  useLayoutStore.getState().setLayout(pk, {
    root: placeholder,
    focusedPaneID: placeholder.id,
    layoutLoading: false,
    layoutLoaded: true,
  });

  const existingScope = useTerminalScopeStore.getState().byScopeId[pk];
  if (!existingScope) {
    useTerminalScopeStore.getState().setTerminalPanel(pk, createEmptyTerminalPanel());
  }
}

// ─── workspace layout loading ─────────────────────────────────────────────────

async function ensureWorkspaceLayoutLoaded(workspace: WorkspaceRecord): Promise<void> {
  if (workspace.status !== "ready") return;

  const layoutState = useLayoutStore.getState().getLayout(workspace.id);
  if (layoutState.layoutLoaded || layoutState.layoutLoading) return;

  const placeholder = createLeaf([]);
  useLayoutStore.getState().setLayout(workspace.id, {
    root: placeholder,
    focusedPaneID: placeholder.id,
    layoutLoading: true,
    layoutLoaded: false,
  });

  let raw: unknown;
  try {
    raw = await invoke<unknown>("load_workspace_layout", { workspaceId: workspace.id });
  } catch (cause) {
    useLayoutStore.getState().setLayout(workspace.id, { layoutLoading: false });
    throw new LayoutLoadError({ workspaceId: workspace.id, cause });
  }

  const layout = raw != null ? migratePersistedLayout(raw) : null;
  useLayoutStore.getState().setLayout(workspace.id, {
    root: layout?.root ?? null,
    focusedPaneID: layout?.focusedPaneID ?? null,
    layoutLoading: false,
    layoutLoaded: true,
  });

  ensureWorkspaceTerminalLayout(
    workspace.id,
    useTerminalScopeStore.getState().byScopeId[workspace.id]?.slots.map((s) => s.id) ?? [],
  );

  terminalStartup.ensureWorkspaceDefaultTerminal(workspace.id, (slotId) => {
    getWorkspaceSession(workspace.id, updateWorkspaceLayout, mutateWorkspaceLayout).commands.addTerminalTab(slotId);
  });
}

// ─── project terminal panel hydration ────────────────────────────────────────

async function hydrateProjectTerminalPanel(scopeId: string): Promise<void> {
  if (!isProjectTerminalKey(scopeId)) return;
  const scope = useTerminalScopeStore.getState().byScopeId[scopeId];
  if (scope && (scope.terminalPanel?.groups.length ?? 0) > 0) return;
  const panel = await loadPersistedProjectTerminalPanel(scopeId);
  if (!panel) return;
  const currentPanel = useTerminalScopeStore.getState().byScopeId[scopeId]?.terminalPanel;
  const reconciledPanel = reconcileProjectTerminalPanelState(
    panel,
    useTerminalScopeStore.getState().byScopeId[scopeId]?.slots.map((s) => s.id) ?? [],
  );
  if (currentPanel !== reconciledPanel) {
    useTerminalScopeStore.getState().setTerminalPanel(scopeId, reconciledPanel);
  }
}

// ─── terminal agent status ────────────────────────────────────────────────────

function acknowledgeWorkspaceTerminalAgentStatus(workspaceId: string): void {
  const layout = useLayoutStore.getState().byWorkspaceId[workspaceId];
  const scope = useTerminalScopeStore.getState().byScopeId[workspaceId];
  if (!scope) return;
  const mutable = {
    root: layout?.root ?? null,
    focusedPaneID: layout?.focusedPaneID ?? null,
    terminalAgentStatusBySlotId: { ...scope.terminalAgentStatusBySlotId },
  };
  acknowledgeSelectedTerminalAgentStatus(mutable);
  for (const [slotId, status] of Object.entries(mutable.terminalAgentStatusBySlotId)) {
    if (status !== scope.terminalAgentStatusBySlotId[slotId]) {
      useTerminalScopeStore.getState().setAgentStatus(workspaceId, slotId, status);
    }
  }
}

// ─── backend services startup ─────────────────────────────────────────────────

async function ensureWorkspaceBackendServicesStarted(workspace: WorkspaceRecord): Promise<void> {
  if (workspace.status !== "ready") return;
  await hydrateProjectTerminalPanel(projectTerminalKey(workspace.projectId));
  if (useNavigationStore.getState().selectedWorkspaceID !== workspace.id) return;
  // Request terminal state from backend directly — no connection lifecycle needed.
  // Backend lazy-opens the scope domain service when it receives these commands.
  getIpcClient()?.requestSnapshot(workspace.id).catch((err) =>
    console.warn(`Failed to request terminal snapshot for workspace ${workspace.id}:`, err),
  );
  getIpcClient()?.requestSnapshot(projectTerminalKey(workspace.projectId)).catch((err) =>
    console.warn(`Failed to request terminal snapshot for project ${workspace.projectId}:`, err),
  );
  await terminalStartup.refreshActiveScopeTerminalStartup({ rebuildHiddenQueues: false });
  if (useNavigationStore.getState().selectedWorkspaceID !== workspace.id) return;
  acknowledgeWorkspaceTerminalAgentStatus(workspace.id);
}

// ─── deferred startup orchestration ──────────────────────────────────────────

export async function continueWorkspaceStartupAfterFileTree(
  workspace: WorkspaceRecord,
): Promise<void> {
  if (workspace.status !== "ready") return;
  ensureProjectTerminalScopeStarted(workspace);
  await ensureWorkspaceLayoutLoaded(workspace);
  if (useNavigationStore.getState().selectedWorkspaceID !== workspace.id) return;
  await ensureWorkspaceBackendServicesStarted(workspace);
}
