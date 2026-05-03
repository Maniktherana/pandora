import { useMemo } from "react";
import { tryCloseEditorTab } from "@/components/editor/close-dirty-editor";
import { editorEnsureFileLoaded } from "@/lib/services/editor/commands";
import { getWorkspaceSession } from "@/lib/services/layout/session";
import {
  mutateWorkspaceLayout,
  updateWorkspaceLayout,
} from "@/lib/services/workspace/startup";

function getLayoutSession(workspaceId: string) {
  return getWorkspaceSession(workspaceId, updateWorkspaceLayout, mutateWorkspaceLayout);
}

export function useEditorActions() {
  return useMemo(
    () => ({
      async openFile(workspaceId: string, workspaceRoot: string, relativePath: string) {
        const ok = await editorEnsureFileLoaded(workspaceId, workspaceRoot, relativePath);
        if (!ok) return;
        getLayoutSession(workspaceId).commands.addEditorTab(relativePath);
      },

      async closeEditorTab(params: {
        workspaceId: string;
        workspaceRoot: string;
        paneID: string;
        tabIndex: number;
        relativePath: string;
        displayName: string;
      }) {
        await tryCloseEditorTab({
          ...params,
          closeTab: (paneID, tabIndex) => {
            getLayoutSession(params.workspaceId).commands.closeTab(paneID, tabIndex);
          },
        });
      },
    }),
    [],
  );
}
