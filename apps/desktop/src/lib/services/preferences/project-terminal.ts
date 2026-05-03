import type { TerminalPanelState } from "@/lib/shared/shared.types";
import { ipcGetUiState, ipcSetUiState } from "@/lib/services/ipc/client";
import { preferenceKeys } from "./keys";

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
      activeGroupIndex: typeof parsed.activeGroupIndex === "number" ? parsed.activeGroupIndex : 0,
      activeSlotId: typeof parsed.activeSlotId === "string" ? parsed.activeSlotId : null,
      visible: parsed.visible === true,
    };
  } catch {
    return null;
  }
}

export async function loadPersistedProjectTerminalPanel(
  projectIdOrKey: string,
): Promise<TerminalPanelState | null> {
  try {
    const raw = await ipcGetUiState(preferenceKeys.projectTerminalPanel(projectIdOrKey));
    return parsePersistedProjectTerminalPanel(raw);
  } catch {
    return null;
  }
}

export async function persistProjectTerminalPanel(
  projectIdOrKey: string,
  panel: TerminalPanelState | null,
): Promise<void> {
  try {
    await ipcSetUiState(
      preferenceKeys.projectTerminalPanel(projectIdOrKey),
      panel ? JSON.stringify(panel) : null,
    );
  } catch {
    // best-effort
  }
}
