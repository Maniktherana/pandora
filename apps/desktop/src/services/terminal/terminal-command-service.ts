import { findLeaf } from "@/components/layout/workspace/layout-migrate";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { tryCloseEditorTab } from "@/components/editor/close-dirty-editor";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import { runtimeGateway } from "@/services/runtime/runtime-gateway";
import { seedProjectTerminal, seedWorkspaceTerminal } from "@/lib/terminal/terminal-seed";
import { TerminalCommandError } from "@/services/service-errors";
import { terminalSurfaceService } from "@/services/terminal/terminal-surface-service";

export function encodeTerminalInput(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}

export function resolveNewTerminalRuntimeId(state: {
  effectiveLayoutRuntimeId: () => string | null;
  selectedWorkspaceID: string | null;
}) {
  return state.effectiveLayoutRuntimeId() ?? state.selectedWorkspaceID;
}

function getClient(runtimeId?: string) {
  const client = runtimeGateway.getClient();
  if (!client) {
    throw new TerminalCommandError({
      cause: new Error("Terminal runtime not connected"),
      ...(runtimeId === undefined ? {} : { runtimeId }),
    });
  }
  return client;
}

async function createProjectTerminal(runtimeId: string, index?: number): Promise<void> {
  const client = getClient(runtimeId);
  let seeded;
  try {
    seeded = await seedProjectTerminal(client, runtimeId);
  } catch (cause) {
    throw new TerminalCommandError({ cause, runtimeId });
  }
  desktopWorkspaceService.addProjectTerminalGroup(runtimeId, seeded.slotID, index);
  desktopWorkspaceService.setProjectTerminalPanelVisible(runtimeId, true);
}

async function closeTerminalSlot(runtimeId: string, slotId: string): Promise<void> {
  const runtime = desktopWorkspaceService.getRuntimeState(runtimeId);
  const slot = desktopWorkspaceService.getSlotState(runtimeId, slotId);
  const sessionIds = new Set<string>(slot?.sessionIDs ?? []);
  for (const session of runtime?.sessions ?? []) {
    if (session.slotID === slotId) sessionIds.add(session.id);
  }

  const client = getClient(runtimeId);
  try {
    await client.send(runtimeId, { type: "remove_slot", slotID: slotId });
  } catch (cause) {
    throw new TerminalCommandError({ cause, runtimeId });
  }
  for (const sessionId of sessionIds) {
    await terminalSurfaceService.removeSurface(sessionId).catch((error) => {
      console.warn("Failed to remove terminal surface after slot close:", error);
    });
  }
  if (isProjectRuntimeKey(runtimeId)) {
    desktopWorkspaceService.closeProjectTerminal(runtimeId, slotId);
  }
}

export const terminalCommandService = {
  newTerminal: async (): Promise<void> => {
    const effectiveLayoutRuntimeId = desktopWorkspaceService.getEffectiveLayoutRuntimeId();
    const selectedWorkspaceId = desktopWorkspaceService.getSelectedWorkspaceId();
    const runtimeId = resolveNewTerminalRuntimeId({
      effectiveLayoutRuntimeId: () => effectiveLayoutRuntimeId,
      selectedWorkspaceID: selectedWorkspaceId,
    });
    if (!runtimeId) return;
    if (isProjectRuntimeKey(runtimeId)) {
      await createProjectTerminal(runtimeId);
      return;
    }
    try {
      await desktopWorkspaceService.ensureWorkspaceRuntimeConnected(runtimeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, runtimeId });
    }
    const client = getClient(runtimeId);
    let seeded;
    try {
      seeded = await seedWorkspaceTerminal(client, runtimeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, runtimeId });
    }
    const session = desktopWorkspaceService.getWorkspaceSession(runtimeId);
    session.commands.addTerminalTab(seeded.slotID);
  },

  createWorkspaceTerminal: async (runtimeId: string): Promise<void> => {
    try {
      await desktopWorkspaceService.ensureWorkspaceRuntimeConnected(runtimeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, runtimeId });
    }
    const client = getClient(runtimeId);
    let seeded;
    try {
      seeded = await seedWorkspaceTerminal(client, runtimeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, runtimeId });
    }
    const session = desktopWorkspaceService.getWorkspaceSession(runtimeId);
    session.commands.addTerminalTab(seeded.slotID);
  },

  createProjectTerminal,

  splitProjectTerminalGroup: async (runtimeId: string, groupId: string): Promise<void> => {
    const client = getClient(runtimeId);
    let seeded;
    try {
      seeded = await seedProjectTerminal(client, runtimeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, runtimeId });
    }
    desktopWorkspaceService.splitProjectTerminalGroup(runtimeId, groupId, seeded.slotID);
    desktopWorkspaceService.setProjectTerminalPanelVisible(runtimeId, true);
  },

  closeTerminalSlot,

  renameTerminal: async (runtimeId: string, slotId: string, name: string): Promise<void> => {
    const client = getClient(runtimeId);
    try {
      await client.send(runtimeId, { type: "update_slot", slot: { id: slotId, name } });
    } catch (cause) {
      throw new TerminalCommandError({ cause, runtimeId });
    }
  },

  sendInput: async (runtimeId: string, sessionId: string, text: string): Promise<void> => {
    const client = getClient(runtimeId);
    try {
      await client.send(runtimeId, {
        type: "input",
        sessionID: sessionId,
        data: encodeTerminalInput(text),
      });
    } catch (cause) {
      throw new TerminalCommandError({ cause, runtimeId });
    }
  },

  closeFocusedTab: async (): Promise<void> => {
    const runtimeId = desktopWorkspaceService.getEffectiveLayoutRuntimeId();
    if (!runtimeId) return;

    const runtime = desktopWorkspaceService.getRuntimeState(runtimeId);
    if (!runtime) return;

    if (isProjectRuntimeKey(runtimeId)) {
      const slotId = runtime.terminalPanel?.activeSlotId;
      if (!slotId) return;
      await closeTerminalSlot(runtimeId, slotId);
      return;
    }

    const focusedPaneID = runtime.focusedPaneID;
    if (!runtime.root || !focusedPaneID) return;
    const leaf = findLeaf(runtime.root, focusedPaneID);
    if (!leaf || leaf.tabs.length === 0) return;

    const index = leaf.selectedIndex;
    const tab = leaf.tabs[index] ?? leaf.tabs[0];
    if (!tab) return;

    if (tab.kind === "terminal") {
      await closeTerminalSlot(runtimeId, tab.slotId);
      return;
    }

    if (tab.kind === "diff" || tab.kind === "review") {
      const session = desktopWorkspaceService.getWorkspaceSession(runtimeId);
      session.commands.closeTab(focusedPaneID, index);
      return;
    }

    const workspace = desktopWorkspaceService.getWorkspaceRecord(runtimeId);
    if (!workspace || workspace.status !== "ready") return;

    const label = tab.path.split("/").pop() ?? tab.path;
    const session = desktopWorkspaceService.getWorkspaceSession(runtimeId);
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
      throw new TerminalCommandError({ cause, runtimeId });
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

    const runtimeId = projectRuntimeKey(selectedProjectId);
    desktopWorkspaceService.setProjectTerminalPanelVisible(runtimeId, true);

    const runtime = desktopWorkspaceService.getRuntimeState(runtimeId);
    if ((runtime?.terminalPanel?.groups.length ?? 0) > 0) return;

    await createProjectTerminal(runtimeId);
  },
};
