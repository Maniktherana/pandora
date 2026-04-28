import type { TerminalPanelState, WorkspaceRuntimeState } from "@/lib/shared/types";
import { getUiState, setUiState, saveWorkspaceLayout } from "./workspace-api";

export async function persistWorkspaceLayout(
  runtime: WorkspaceRuntimeState | undefined,
  workspaceId: string,
): Promise<void> {
  const root =
    runtime?.root?.type === "leaf" && runtime.root.tabs.length === 0
      ? null
      : (runtime?.root ?? null);
  const layout = {
    root,
    focusedPaneID: root ? (runtime?.focusedPaneID ?? null) : null,
  };
  try {
    await saveWorkspaceLayout(workspaceId, layout);
  } catch {
    // best-effort
  }
}

export function projectTerminalPanelStorageKey(runtimeId: string) {
  return `project-terminal-panel:${runtimeId}`;
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
  runtimeId: string,
): Promise<TerminalPanelState | null> {
  try {
    const raw = await getUiState(projectTerminalPanelStorageKey(runtimeId));
    return parsePersistedProjectTerminalPanel(raw);
  } catch {
    return null;
  }
}

export async function persistProjectTerminalPanel(
  runtimeId: string,
  panel: TerminalPanelState | null,
): Promise<void> {
  try {
    await setUiState(
      projectTerminalPanelStorageKey(runtimeId),
      panel ? JSON.stringify(panel) : null,
    );
  } catch {
    // best-effort
  }
}
