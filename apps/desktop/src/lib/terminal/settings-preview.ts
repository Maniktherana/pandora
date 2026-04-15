import type { SessionState, SlotState } from "@/lib/shared/types";

export const SETTINGS_PREVIEW_NAME = "Settings Preview";
export const SETTINGS_PREVIEW_RUNTIME_ID = "__settings_terminal__";
export const SETTINGS_PREVIEW_SLOT_ID_PREFIX = "__settings_preview_slot__:";
export const SETTINGS_PREVIEW_SESSION_DEF_ID_PREFIX = "__settings_preview_session_def__:";

export function isSettingsPreviewSlot(slot: Pick<SlotState, "id" | "name">): boolean {
  return slot.id.startsWith(SETTINGS_PREVIEW_SLOT_ID_PREFIX) || slot.name === SETTINGS_PREVIEW_NAME;
}

export function isSettingsPreviewSession(
  session: Pick<SessionState, "slotID" | "sessionDefID" | "name">,
): boolean {
  return (
    session.slotID.startsWith(SETTINGS_PREVIEW_SLOT_ID_PREFIX) ||
    session.sessionDefID.startsWith(SETTINGS_PREVIEW_SESSION_DEF_ID_PREFIX) ||
    session.name === SETTINGS_PREVIEW_NAME
  );
}
