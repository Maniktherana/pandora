import { memo, useCallback, useRef } from "react";
import WorkspaceChangesPanel from "@/components/layout/right-sidebar/scm/workspace-changes-panel";
import { useLayoutStore } from "@/services/workspace/layout-store";
import { findLeaf } from "@/components/layout/workspace/layout-tree";
import { useScmStatusCached } from "@/services/git/git-queries";
import { getIpcClient } from "@/services/ipc/ipc-lifecycle";
import type { LeftPanelMode } from "./files/files.types";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { FileTreeToolbar } from "./files/file-tree-toolbar";
import { useAvailableEditors } from "@/hooks/use-available-editors";
import { FileTreePanel, type FileTreePanelHandle } from "./files/file-tree-panel";

export default memo(function RightSidebar({
  workspaceRoot,
  workspaceId,
  workspaceName,
  projectDisplayName,
  mode,
}: {
  workspaceRoot: string;
  workspaceId: string;
  workspaceName: string;
  projectDisplayName: string;
  mode: LeftPanelMode;
}) {
  const { openFile } = useEditorActions();
  const statusData = useScmStatusCached(workspaceId);
  const { data: availableEditors } = useAvailableEditors();
  const treeRef = useRef<FileTreePanelHandle>(null);

  const activePath = useLayoutStore((s) => {
    const layout = s.byWorkspaceId[workspaceId];
    if (!layout?.root || !layout.focusedPaneID) return null;
    const leaf = findLeaf(layout.root, layout.focusedPaneID);
    const tab = leaf?.tabs[leaf.selectedIndex] ?? leaf?.tabs[0];
    return tab && (tab.kind === "editor" || tab.kind === "diff") ? tab.path : null;
  });

  const workspaceTreeLabel = `${projectDisplayName} / ${workspaceName}`;

  const handleFileOpen = useCallback(
    (wsId: string, wsRoot: string, path: string) => { void openFile(wsId, wsRoot, path); },
    [openFile],
  );

  const ipc = getIpcClient();

  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)] select-none">
      <div
        className="absolute inset-0 min-w-0"
        style={mode !== "changes" ? { display: "none" } : undefined}
      >
        <WorkspaceChangesPanel
          workspaceRoot={workspaceRoot}
          workspaceId={workspaceId}
          workspaceLabel={workspaceTreeLabel}
        />
      </div>

      <div
        className="absolute inset-0 flex min-w-0 flex-col"
        style={mode !== "files" ? { display: "none" } : undefined}
      >
        <FileTreeToolbar
          workspaceTreeLabel={workspaceTreeLabel}
          onCreateFile={() => treeRef.current?.createFile()}
          onCreateFolder={() => treeRef.current?.createFolder()}
          onRefreshExplorer={() => ipc?.fileTreeRefresh(workspaceId).catch(console.error)}
          onCollapseAll={() => treeRef.current?.collapseAll()}
        />
        <div className="relative min-h-0 flex-1">
          <FileTreePanel
            ref={treeRef}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            activePath={activePath}
            scmEntries={statusData?.entries}
            availableEditors={availableEditors ?? []}
            onFileOpen={handleFileOpen}
          />
        </div>
      </div>
    </div>
  );
});
