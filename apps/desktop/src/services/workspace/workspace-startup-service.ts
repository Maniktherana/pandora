import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceRecord } from "@/lib/shared/types";
import { getIpcClient } from "@/services/ipc/ipc-lifecycle";
import { useTerminalScopeStore } from "@/services/terminal/terminal-scope-store";
import {
  createTerminalStartupService,
} from "@/services/terminal/terminal-startup-service";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import {
  acknowledgeSelectedTerminalAgentStatus,
} from "@/lib/terminal/agent-activity";
import {
  getWorkspaceSession,
} from "@/services/workspace/workspace-session-service";
import {
  persistWorkspaceLayout,
  loadPersistedProjectTerminalPanel,
} from "@/services/workspace/workspace-persistence";
import { useFileTreeStore } from "@/services/file-tree/file-tree-store";
import { loadFileTreeExpandedPaths } from "@/services/file-tree/file-tree-preferences";
import { gitInit } from "@/services/git/git-service";
import { useNavigationStore } from "@/services/workspace/navigation-store";
import { useCatalogStore } from "@/services/workspace/catalog-store";
import { useLayoutStore } from "@/services/workspace/layout-store";
import { LayoutLoadError } from "@/lib/runtime/errors";
import { createLeaf } from "@/components/layout/workspace/layout-tree";
import { migratePersistedLayout } from "@/components/layout/workspace/layout-migrate";
import { createEmptyTerminalPanel } from "@/lib/terminal/bottom-terminal-panel";
import { reconcileProjectTerminalPanelState } from "@/services/terminal/project-terminal-panel-model";
import { ensureWorkspaceTerminalLayout } from "@/services/workspace/workspace-layout-model";

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

  const pk = projectRuntimeKey(workspace.projectId);
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
  if (!isProjectRuntimeKey(scopeId)) return;
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

// ─── file tree init ───────────────────────────────────────────────────────────

const fileTreeSubscribed = new Set<string>();

async function fileTreeInit(scopeId: string): Promise<void> {
  const current = useFileTreeStore.getState().byScopeId[scopeId];
  if (current?.bootStatus === "loaded" && fileTreeSubscribed.has(scopeId)) return;

  useFileTreeStore.getState().setBootLoading(scopeId);
  const client = getIpcClient();
  if (!client) return;

  try {
    const paths = await loadFileTreeExpandedPaths(scopeId);
    fileTreeSubscribed.add(scopeId);
    client.fileTreeSubscribe(scopeId, paths).catch(() => fileTreeSubscribed.delete(scopeId));
  } catch {
    fileTreeSubscribed.add(scopeId);
    client.fileTreeSubscribe(scopeId).catch(() => fileTreeSubscribed.delete(scopeId));
  }
}

// ─── backend services startup ─────────────────────────────────────────────────

async function ensureWorkspaceBackendServicesStarted(workspace: WorkspaceRecord): Promise<void> {
  if (workspace.status !== "ready") return;
  await fileTreeInit(workspace.id);
  await hydrateProjectTerminalPanel(projectRuntimeKey(workspace.projectId));
  // Request terminal state from backend directly — no connection lifecycle needed.
  // Backend lazy-opens the scope domain service when it receives these commands.
  getIpcClient()?.requestSnapshot(workspace.id).catch((err) =>
    console.warn(`Failed to request terminal snapshot for workspace ${workspace.id}:`, err),
  );
  getIpcClient()?.requestSnapshot(projectRuntimeKey(workspace.projectId)).catch((err) =>
    console.warn(`Failed to request terminal snapshot for project ${workspace.projectId}:`, err),
  );
  await terminalStartup.refreshActiveScopeTerminalStartup({ rebuildHiddenQueues: false });
  acknowledgeWorkspaceTerminalAgentStatus(workspace.id);
}

// ─── background startup orchestration ────────────────────────────────────────

export async function startSelectedWorkspaceBackgroundStartup(workspaceId: string): Promise<void> {
  const workspace = useCatalogStore.getState().workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace || workspace.status !== "ready") return;
  if (useNavigationStore.getState().selectedWorkspaceID !== workspace.id) return;

  // Start Git subscription immediately so data is warm before the user opens the sidebar.
  // This must not wait for layout load or file-tree init.
  gitInit(workspace.id);

  ensureProjectTerminalScopeStarted(workspace);
  await ensureWorkspaceLayoutLoaded(workspace);
  await ensureWorkspaceBackendServicesStarted(workspace);
}
