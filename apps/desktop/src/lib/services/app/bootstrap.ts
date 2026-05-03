import { listen } from "@tauri-apps/api/event";
import type { WorkspaceRecord } from "@/lib/shared/shared.types";
import { subscribeIpcEvents } from "@/lib/services/ipc/router";
import {
  patchWorkspaceRecord,
  applyAppState,
} from "@/lib/services/workspace/view";
import { loadAppState, prLink } from "@/lib/services/workspace/api";
import { useCatalogStore } from "@/lib/services/catalog/store";
import { useNavigationStore } from "@/lib/services/navigation/store";
import { DesktopStateLoadError } from "@/lib/services/errors";
import {
  selectWorkspaceById,
  setSelectionTarget,
} from "@/lib/services/navigation/actions";
import {
  terminalStartup,
  updateWorkspaceLayout,
  mutateWorkspaceLayout,
} from "@/lib/services/workspace/startup";
import {
  startSelectedWorkspaceBackgroundStartup,
} from "@/lib/services/workspace/activate";
import { getWorkspaceSession } from "@/lib/services/layout/session";
import { gitInit, gitInitMany } from "@/lib/services/git/commands";

// ─── module-level lifecycle state ─────────────────────────────────────────────

let unsubscribeIpcEvents: (() => void) | null = null;
let unlistenWorkspaceRecord: (() => void) | null = null;

// ─── PR awaiting state ────────────────────────────────────────────────────────

const prAwaitingWorkspaceIds = new Set<string>();

// ─── IPC event routing ────────────────────────────────────────────────────────

function startIpcEventRouting(): void {
  if (unsubscribeIpcEvents) return;
  unsubscribeIpcEvents = subscribeIpcEvents({
    getSelectedWorkspaceId: () => useNavigationStore.getState().selectedWorkspaceID,
    onSlotAdded: (scopeId) => {
      terminalStartup.ensureWorkspaceDefaultTerminal(scopeId, (slotId) => {
        getWorkspaceSession(scopeId, updateWorkspaceLayout, mutateWorkspaceLayout).commands.addTerminalTab(slotId);
      });
      terminalStartup.refreshScopeTerminalStartup(scopeId).catch((err) =>
        console.warn("Failed to refresh scope terminal startup:", err),
      );
    },
    onScopeUpdated: (scopeId) => {
      terminalStartup.refreshScopeTerminalStartup(scopeId).catch((err) =>
        console.warn("Failed to refresh scope terminal startup:", err),
      );
    },
    getPrAwaitingWorkspaceIds: () => prAwaitingWorkspaceIds,
    onPrDetected: (workspaceId, detectedPrUrl, detectedPrNumber) => {
      prAwaitingWorkspaceIds.delete(workspaceId);
      const workspace = useCatalogStore.getState().workspaces.find((w) => w.id === workspaceId);
      if (workspace) {
        useCatalogStore.getState().patchWorkspace({
          ...workspace,
          prUrl: detectedPrUrl,
          prNumber: detectedPrNumber,
          prState: "open",
        });
      }
      prLink(workspaceId, detectedPrUrl, detectedPrNumber).catch((err) =>
        console.warn("Failed to persist PR link:", err),
      );
    },
  });
}

// ─── workspace record listener ────────────────────────────────────────────────

function startWorkspaceRecordListener(): void {
  if (unlistenWorkspaceRecord) return;
  listen<WorkspaceRecord>("workspace_record_changed", ({ payload }) => {
    patchWorkspaceRecord(payload);
    if (payload.status === "ready") {
      gitInit(payload.id);
    }
    if (
      payload.id === useNavigationStore.getState().selectedWorkspaceID &&
      payload.status === "ready"
    ) {
      startSelectedWorkspaceBackgroundStartup(payload.id).catch((error) =>
        console.warn("Failed to start workspace background startup:", error),
      );
    }
  })
    .then((unlisten) => {
      unlistenWorkspaceRecord = unlisten;
    })
    .catch((cause) =>
      console.error("Failed to listen to workspace_record_changed:", cause),
    );
}

// ─── public API ───────────────────────────────────────────────────────────────

export const appBootstrapService = {
  init(): void {
    startIpcEventRouting();
    startWorkspaceRecordListener();
  },

  async loadDesktopState(): Promise<void> {
    let appState;
    try {
      appState = await loadAppState();
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
    const { allowedScopeIds } = applyAppState(appState);
    terminalStartup.cleanupAllowedScopeIds(allowedScopeIds);
    gitInitMany(
      appState.workspaces
        .filter((workspace) => workspace.status === "ready")
        .map((workspace) => workspace.id),
    );
    setSelectionTarget(appState.selectedWorkspaceId ?? null);

    const selectedWorkspaceId = useNavigationStore.getState().selectedWorkspaceID;
    if (!selectedWorkspaceId) return;
    try {
      await selectWorkspaceById(selectedWorkspaceId);
      startSelectedWorkspaceBackgroundStartup(selectedWorkspaceId).catch((error) =>
        console.warn("Failed to start workspace background startup:", error),
      );
    } catch (e) {
      throw new DesktopStateLoadError({ cause: e });
    }
  },

  async reloadDesktopState(): Promise<void> {
    let appState;
    try {
      appState = await loadAppState();
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
    const { allowedScopeIds } = applyAppState(appState);
    terminalStartup.cleanupAllowedScopeIds(allowedScopeIds);
    gitInitMany(
      appState.workspaces
        .filter((workspace) => workspace.status === "ready")
        .map((workspace) => workspace.id),
    );
    setSelectionTarget(appState.selectedWorkspaceId ?? null);

    const selectedWorkspaceId = useNavigationStore.getState().selectedWorkspaceID;
    if (selectedWorkspaceId) {
      startSelectedWorkspaceBackgroundStartup(selectedWorkspaceId).catch((error) =>
        console.warn("Failed to start workspace background startup:", error),
      );
    }
    await terminalStartup.refreshActiveScopeTerminalStartup({ rebuildHiddenQueues: true });
  },

  setPrAwaiting(workspaceId: string, awaiting: boolean): void {
    if (awaiting) {
      prAwaitingWorkspaceIds.add(workspaceId);
      setTimeout(() => {
        prAwaitingWorkspaceIds.delete(workspaceId);
      }, 90_000);
    } else {
      prAwaitingWorkspaceIds.delete(workspaceId);
    }
  },

  dispose(): void {
    unsubscribeIpcEvents?.();
    unsubscribeIpcEvents = null;
    unlistenWorkspaceRecord?.();
    unlistenWorkspaceRecord = null;
  },
};
