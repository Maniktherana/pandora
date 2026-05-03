import { findLeaf } from "@/lib/shared/utils";
import { isProjectTerminalKey, projectTerminalKey } from "@/lib/services/terminal/project-key";
import { tryCloseEditorTab } from "@/components/editor/close-dirty-editor";
import { getIpcClient } from "@/lib/services/ipc/lifecycle";
import { seedProjectTerminal, seedWorkspaceTerminal } from "@/lib/services/terminal/seed";
import { TerminalCommandError } from "@/lib/services/errors";
import { projectTerminalActions } from "@/lib/services/terminal/project";
import { showWorkspaceTerminalTab } from "@/lib/services/terminal/workspace";
import { useTerminalScopeStore } from "@/lib/services/terminal/store";
import { useLayoutStore } from "@/lib/services/layout/store";
import { getWorkspaceSession } from "@/lib/services/layout/session";
import { useCatalogStore } from "@/lib/services/catalog/store";
import { useNavigationStore } from "@/lib/services/navigation/store";
import {
  mutateWorkspaceLayout,
  updateWorkspaceLayout,
} from "@/lib/services/workspace/startup";

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

function getEffectiveLayoutScopeId(): string | null {
  const navigation = useNavigationStore.getState();
  return navigation.layoutTargetScopeId ?? navigation.selectedWorkspaceID;
}

function getLayoutSession(workspaceId: string) {
  return getWorkspaceSession(workspaceId, updateWorkspaceLayout, mutateWorkspaceLayout);
}

async function createProjectTerminal(scopeId: string, index?: number): Promise<void> {
  const client = requireIpcClient(scopeId);
  let seeded;
  try {
    seeded = await seedProjectTerminal(client, scopeId);
  } catch (cause) {
    throw new TerminalCommandError({ cause, scopeId });
  }
  projectTerminalActions.addProjectTerminalGroup(scopeId, seeded.slotID, index);
  projectTerminalActions.setProjectTerminalPanelVisible(scopeId, true);
}

async function closeTerminalSlot(scopeId: string, slotId: string): Promise<void> {
  const client = getIpcClient();
  if (!client) {
    console.warn("IPC client not available while closing terminal slot", { scopeId, slotId });
    return;
  }
  try {
    await client.send(scopeId, { type: "remove_slot", slotID: slotId });
  } catch (cause) {
    console.warn("Failed to remove terminal slot in backend", { scopeId, slotId, cause });
  }
}

export const terminalCommandService = {
  newTerminal: async (): Promise<void> => {
    const navigation = useNavigationStore.getState();
    const scopeId = resolveNewTerminalScopeId({
      effectiveLayoutScopeId: () => navigation.layoutTargetScopeId,
      selectedWorkspaceID: navigation.selectedWorkspaceID,
    });
    if (!scopeId) return;
    if (isProjectTerminalKey(scopeId)) {
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
    showWorkspaceTerminalTab(scopeId, seeded.slotID);
  },

  createWorkspaceTerminal: async (scopeId: string): Promise<void> => {
    const client = requireIpcClient(scopeId);
    let seeded;
    try {
      seeded = await seedWorkspaceTerminal(client, scopeId);
    } catch (cause) {
      throw new TerminalCommandError({ cause, scopeId });
    }
    showWorkspaceTerminalTab(scopeId, seeded.slotID);
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
    projectTerminalActions.splitProjectTerminalGroup(scopeId, groupId, seeded.slotID);
    projectTerminalActions.setProjectTerminalPanelVisible(scopeId, true);
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
    const scopeId = getEffectiveLayoutScopeId();
    if (!scopeId) return;

    const scope = useTerminalScopeStore.getState().byScopeId[scopeId];
    const layout = useLayoutStore.getState().byWorkspaceId[scopeId];

    if (isProjectTerminalKey(scopeId)) {
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
      getLayoutSession(scopeId).commands.closeTab(focusedPaneID, index);
      return;
    }

    const workspace = useCatalogStore.getState().workspaces.find((w) => w.id === scopeId);
    if (!workspace || workspace.status !== "ready") return;

    const label = tab.path.split("/").pop() ?? tab.path;
    try {
      await tryCloseEditorTab({
        workspaceId: workspace.id,
        workspaceRoot: workspace.worktreePath,
        paneID: focusedPaneID,
        tabIndex: index,
        relativePath: tab.path,
        displayName: label,
        closeTab: (paneID, tabIndex) => {
          getLayoutSession(scopeId).commands.closeTab(paneID, tabIndex);
        },
      });
    } catch (cause) {
      throw new TerminalCommandError({ cause, scopeId });
    }
  },

  toggleBottomPanel: async (currentlyOpen: boolean): Promise<void> => {
    if (currentlyOpen) return;

    const navigation = useNavigationStore.getState();
    const selectedProjectId = navigation.selectedProjectID;
    const selectedWorkspaceId = navigation.selectedWorkspaceID;
    const selectedWorkspace = selectedWorkspaceId
      ? useCatalogStore.getState().workspaces.find((w) => w.id === selectedWorkspaceId)
      : null;
    if (!selectedProjectId || selectedWorkspace?.status !== "ready") return;

    const scopeId = projectTerminalKey(selectedProjectId);
    projectTerminalActions.setProjectTerminalPanelVisible(scopeId, true);

    const scope = useTerminalScopeStore.getState().byScopeId[scopeId];
    if ((scope?.terminalPanel?.groups.length ?? 0) > 0) return;

    await createProjectTerminal(scopeId);
  },
};
