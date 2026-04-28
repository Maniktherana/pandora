import { useMemo } from "react";
import { tryCloseEditorTab } from "@/components/editor/close-dirty-editor";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import { editorEnsureFileLoaded } from "@/services/editor/editor-service";

export function useEditorActions() {
  return useMemo(
    () => ({
      async openFile(workspaceId: string, workspaceRoot: string, relativePath: string) {
        const ok = await editorEnsureFileLoaded(workspaceId, workspaceRoot, relativePath);
        if (!ok) return;
        const session = desktopWorkspaceService.getWorkspaceSession(workspaceId);
        session.commands.addEditorTab(relativePath);
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
            const session = desktopWorkspaceService.getWorkspaceSession(params.workspaceId);
            session.commands.closeTab(paneID, tabIndex);
          },
        });
      },
    }),
    [],
  );
}
