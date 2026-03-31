import { message } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const LABEL_SAVE = "Save";
const LABEL_DISCARD = "Don't Save";
const LABEL_CANCEL = "Cancel";

function interpretUnsavedResult(result: string): "save" | "discard" | "cancel" {
  if (result === LABEL_CANCEL || result === "Cancel") return "cancel";
  if (result === LABEL_SAVE || result === "Yes") return "save";
  if (result === LABEL_DISCARD || result === "No") return "discard";
  return "cancel";
}

export async function promptUnsavedChangesBeforeClose(displayName: string): Promise<"save" | "discard" | "cancel"> {
  const result = await message(`Save changes to "${displayName}" before closing?`, {
    title: "Unsaved changes",
    kind: "warning",
    buttons: { yes: LABEL_SAVE, no: LABEL_DISCARD, cancel: LABEL_CANCEL },
  });
  return interpretUnsavedResult(String(result));
}

/** Close an editor tab; prompts when the buffer differs from last saved content. */
export async function tryCloseEditorTab(params: {
  workspaceId: string;
  workspaceRoot: string;
  paneID: string;
  tabIndex: number;
  relativePath: string;
  displayName: string;
}): Promise<void> {
  const { workspaceId, workspaceRoot, paneID, tabIndex, relativePath, displayName } = params;
  const editor = useEditorStore.getState();

  if (!editor.isFileDirty(workspaceId, relativePath)) {
    editor.forgetFile(workspaceId, relativePath);
    useWorkspaceStore.getState().removePaneTabByIndex(paneID, tabIndex);
    return;
  }

  const choice = await promptUnsavedChangesBeforeClose(displayName);
  if (choice === "cancel") return;

  if (choice === "save") {
    const ok = await editor.saveFile(workspaceId, workspaceRoot, relativePath);
    if (!ok) return;
  }

  editor.forgetFile(workspaceId, relativePath);
  useWorkspaceStore.getState().removePaneTabByIndex(paneID, tabIndex);
}
