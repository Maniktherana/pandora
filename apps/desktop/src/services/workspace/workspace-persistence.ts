import type { TerminalPanelState } from "@/lib/shared/types";
import { getUiState, setUiState, saveWorkspaceLayout } from "./workspace-api";
import { useLayoutStore } from "@/services/workspace/layout-store";

export async function persistWorkspaceLayout(workspaceId: string): Promise<void> {
  const workspaceLayout = useLayoutStore.getState().getLayout(workspaceId);
  const root =
    workspaceLayout.root?.type === "leaf" && workspaceLayout.root.tabs.length === 0
      ? null
      : workspaceLayout.root;
  const layout = {
    root,
    focusedPaneID: root ? workspaceLayout.focusedPaneID : null,
  };
  try {
    await saveWorkspaceLayout(workspaceId, layout);
  } catch {
    // best-effort
  }
}

export function projectTerminalPanelStorageKey(scopeId: string) {
  return `project-terminal-panel:${scopeId}`;
}

export function parsePersistedProjectTerminalPanel(
  raw: string | null,
): TerminalPanelState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalPanelState>;
    if (!Array.isArray(parsed?.groups)) return null;
    return {
      groups: parsed.groups
        .filter(
          (group): group is { id: string; children: string[] } =>
            Boolean(group) &&
            typeof group.id === "string" &&
            Array.isArray(group.children) &&
            group.children.every((child) => typeof child === "string"),
        )
        .map((group) => ({ id: group.id, children: [...group.children] })),
      activeGroupIndex:
        typeof parsed.activeGroupIndex === "number" ? parsed.activeGroupIndex : 0,
      activeSlotId: typeof parsed.activeSlotId === "string" ? parsed.activeSlotId : null,
      visible: parsed.visible === true,
    };
  } catch {
    return null;
  }
}

export async function loadPersistedProjectTerminalPanel(
  scopeId: string,
): Promise<TerminalPanelState | null> {
  try {
    const raw = await getUiState(projectTerminalPanelStorageKey(scopeId));
    return parsePersistedProjectTerminalPanel(raw);
  } catch {
    return null;
  }
}

export async function persistProjectTerminalPanel(
  scopeId: string,
  panel: TerminalPanelState | null,
): Promise<void> {
  try {
    await setUiState(
      projectTerminalPanelStorageKey(scopeId),
      panel ? JSON.stringify(panel) : null,
    );
  } catch {
    // best-effort
  }
}
