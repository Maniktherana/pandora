import { findLeaf } from "@/components/layout/workspace/layout-migrate";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { tryCloseEditorTab } from "@/components/editor/close-dirty-editor";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import { getIpcClient } from "@/services/ipc/ipc-lifecycle";
import { seedProjectTerminal, seedWorkspaceTerminal } from "@/lib/terminal/terminal-seed";
import { TerminalCommandError } from "@/services/service-errors";
import { terminalSurfaceService } from "@/services/terminal/terminal-surface-service";
import { useTerminalScopeStore } from "@/services/terminal/terminal-scope-store";
import { useLayoutStore } from "@/services/workspace/layout-store";

export function encodeTerminalInput(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}

export function resolveNewTerminalScopeId(state: {
  effectiveLayoutScopeId: () => string | null;
  selectedWorkspaceID: string | null;
}) {
  return state.effectiveLayoutScopeId() ?? state.selectedWorkspaceID;
}

function requireIpcClient(scopeId?: string) {
  const client = getIpcClient();
  if (!client) {
    throw new TerminalCommandError({
      cause: new Error("IPC client not available"),
      ...(scopeId === undefined ? {} : { scopeId }),
    });
  }
  return client;
}

async function createProjectTerminal(scopeId: string, index?: number): Promise<void> {
  const client = requireIpcClient(scopeId);
  let seeded;
  try {
    seeded = await seedProjectTerminal(client, scopeId);
  } catch (cause) {
    throw new TerminalCommandError({ cause, scopeId });
  }
  desktopWorkspaceService.addProjectTerminalGroup(scopeId, seeded.slotID, index);
  desktopWorkspaceService.setProjectTerminalPanelVisible(scopeId, true);
}

async function closeTerminalSlot(scopeId: string, slotId: string): Promise<void> {
  const scope = useTerminalScopeStore.getState().byScopeId[scopeId];
  const slot = scope?.slots.find((s) => s.id === slotId);
  const sessionIds = new Set<string>(slot?.sessionIDs ?? []);
  for (const session of scope?.sessions ?? []) {
    if (session.slotID === slotId) sessionIds.add(session.id);
  }

  const client = requireIpcClient(scopeId);
  try {
    await client.send(scopeId, { type: "remove_slot", slotID: slotId });
  } catch (cause) {
    throw new TerminalCommandError({ cause, scopeId });
  }
  for (const sessionId of sessionIds) {
    await terminalSurfaceService.removeSurface(sessionId).catch((error) => {
      console.warn("Failed to remove terminal surface after slot close:", error);
    });
  }
  if (isProjectRuntimeKey(scopeId)) {
    desktopWorkspaceService.closeProjectTerminal(scopeId, slotId);
  }
}

export const terminalCommandService = {
  newTerminal: async (): Promise<void> => {
    const effectiveLayoutScopeId = desktopWorkspaceService.getEffectiveLayoutScopeId();
    const selectedWorkspaceId = desktopWorkspaceService.getSelectedWorkspaceId();
    const scopeId = resolveNewTerminalScopeId({
      effectiveLayoutScopeId: () => effectiveLayoutScopeId,
      selectedWorkspaceID: selectedWorkspaceId,
    });
    if (!scopeId) return;
    if (isProjectRuntimeKey(scopeId)) {
      await createProjectTerminal(scopeId);
      return;
    }
    const client = requireIpcClient(scopeId);
    let seeded;
    try {
      seeded = await seedWorkspaceTerminal(client, scopeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, scopeId });
    }
    const session = desktopWorkspaceService.getWorkspaceSession(scopeId);
    session.commands.addTerminalTab(seeded.slotID);
  },

  createWorkspaceTerminal: async (scopeId: string): Promise<void> => {
    const client = requireIpcClient(scopeId);
    let seeded;
    try {
      seeded = await seedWorkspaceTerminal(client, scopeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, scopeId });
    }
    const session = desktopWorkspaceService.getWorkspaceSession(scopeId);
    session.commands.addTerminalTab(seeded.slotID);
  },

  createProjectTerminal,

  splitProjectTerminalGroup: async (scopeId: string, groupId: string): Promise<void> => {
    const client = requireIpcClient(scopeId);
    let seeded;
    try {
      seeded = await seedProjectTerminal(client, scopeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, scopeId });
    }
    desktopWorkspaceService.splitProjectTerminalGroup(scopeId, groupId, seeded.slotID);
    desktopWorkspaceService.setProjectTerminalPanelVisible(scopeId, true);
  },

  closeTerminalSlot,

  renameTerminal: async (scopeId: string, slotId: string, name: string): Promise<void> => {
    const client = requireIpcClient(scopeId);
    try {
      await client.send(scopeId, { type: "update_slot", slot: { id: slotId, name } });
    } catch (cause) {
      throw new TerminalCommandError({ cause, scopeId });
    }
  },

  sendInput: async (scopeId: string, sessionId: string, text: string): Promise<void> => {
    const client = requireIpcClient(scopeId);
    try {
      await client.send(scopeId, {
        type: "input",
        sessionID: sessionId,
        data: encodeTerminalInput(text),
      });
    } catch (cause) {
      throw new TerminalCommandError({ cause, scopeId });
    }
  },

  closeFocusedTab: async (): Promise<void> => {
    const scopeId = desktopWorkspaceService.getEffectiveLayoutScopeId();
    if (!scopeId) return;

    const scope = useTerminalScopeStore.getState().byScopeId[scopeId];
    const layout = useLayoutStore.getState().byWorkspaceId[scopeId];

    if (isProjectRuntimeKey(scopeId)) {
      const slotId = scope?.terminalPanel?.activeSlotId;
      if (!slotId) return;
      await closeTerminalSlot(scopeId, slotId);
      return;
    }

    const focusedPaneID = layout?.focusedPaneID ?? null;
    const root = layout?.root ?? null;
    if (!root || !focusedPaneID) return;
    const leaf = findLeaf(root, focusedPaneID);
    if (!leaf || leaf.tabs.length === 0) return;

    const index = leaf.selectedIndex;
    const tab = leaf.tabs[index] ?? leaf.tabs[0];
    if (!tab) return;

    if (tab.kind === "terminal") {
      await closeTerminalSlot(scopeId, tab.slotId);
      return;
    }

    if (tab.kind === "diff" || tab.kind === "review") {
      const session = desktopWorkspaceService.getWorkspaceSession(scopeId);
      session.commands.closeTab(focusedPaneID, index);
      return;
    }

    const workspace = desktopWorkspaceService.getWorkspaceRecord(scopeId);
    if (!workspace || workspace.status !== "ready") return;

    const label = tab.path.split("/").pop() ?? tab.path;
    const session = desktopWorkspaceService.getWorkspaceSession(scopeId);
    try {
      await tryCloseEditorTab({
        workspaceId: workspace.id,
        workspaceRoot: workspace.worktreePath,
        paneID: focusedPaneID,
        tabIndex: index,
        relativePath: tab.path,
        displayName: label,
        closeTab: (paneID, tabIndex) => {
          session.commands.closeTab(paneID, tabIndex);
        },
      });
    } catch (cause) {
      throw new TerminalCommandError({ cause, scopeId });
    }
  },

  toggleBottomPanel: async (currentlyOpen: boolean): Promise<void> => {
    if (currentlyOpen) return;

    const selectedProjectId = desktopWorkspaceService.getSelectedProjectId();
    const selectedWorkspaceId = desktopWorkspaceService.getSelectedWorkspaceId();
    const selectedWorkspace = selectedWorkspaceId
      ? desktopWorkspaceService.getWorkspaceRecord(selectedWorkspaceId)
      : null;
    if (!selectedProjectId || selectedWorkspace?.status !== "ready") return;

    const scopeId = projectRuntimeKey(selectedProjectId);
    desktopWorkspaceService.setProjectTerminalPanelVisible(scopeId, true);

    const scope = useTerminalScopeStore.getState().byScopeId[scopeId];
    if ((scope?.terminalPanel?.groups.length ?? 0) > 0) return;

    await createProjectTerminal(scopeId);
  },
};
