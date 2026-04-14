import { message } from "@tauri-apps/plugin-dialog";
import { useEditorStore } from "@/state/editor-store";
import { getMonacoModelContent } from "@/components/editor/monaco-pandora";

const LABEL_SAVE = "Save";
const LABEL_DISCARD = "Don't Save";
const LABEL_CANCEL = "Cancel";

function interpretUnsavedResult(result: string): "save" | "discard" | "cancel" {
  if (result === LABEL_CANCEL || result === "Cancel") return "cancel";
  if (result === LABEL_SAVE || result === "Yes") return "save";
  if (result === LABEL_DISCARD || result === "No") return "discard";
  return "cancel";
}

export async function promptUnsavedChangesBeforeClose(
  displayName: string,
): Promise<"save" | "discard" | "cancel"> {
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
  closeTab: (paneID: string, tabIndex: number) => Promise<void> | void;
}): Promise<void> {
  const { workspaceId, workspaceRoot, paneID, tabIndex, relativePath, displayName, closeTab } =
    params;
  const editor = useEditorStore.getState();

  if (!editor.isFileDirty(workspaceId, relativePath)) {
    editor.forgetFile(workspaceId, relativePath);
    await closeTab(paneID, tabIndex);
    return;
  }

  const choice = await promptUnsavedChangesBeforeClose(displayName);
  if (choice === "cancel") return;

  if (choice === "save") {
    // Read from Monaco model directly — the debounced store buffer may be stale.
    const content = getMonacoModelContent(relativePath);
    const ok = await editor.saveFile(workspaceId, workspaceRoot, relativePath, content);
    if (!ok) return;
  }

  editor.forgetFile(workspaceId, relativePath);
  await closeTab(paneID, tabIndex);
}
