import { useCallback, useEffect, useMemo } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import ReviewFileViewer from "@/components/editor/review-file-viewer";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { languageFromRelativePath } from "@/lib/editor/editor-language";
import { pandoraMonacoBeforeMount, PANDORA_EDITOR_BG } from "@/lib/editor/monaco-pandora";
import type { CodePresentationMode } from "@/lib/shared/types";

const editorOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: "on" as const,
  scrollBeyondLastLine: true,
  automaticLayout: true,
  tabSize: 2,
  padding: { top: 8 },
  /** Hide squiggles from any language service that still reports markers. */
  renderValidationDecorations: "off" as const,
};

const editorLoading = (
  <div className="h-full w-full" style={{ backgroundColor: PANDORA_EDITOR_BG }} aria-hidden />
);

export default function PaneEditor({
  workspaceId,
  workspaceRoot,
  relativePath,
  isActive,
  presentationMode,
}: {
  workspaceId: string;
  workspaceRoot: string;
  relativePath: string;
  isActive: boolean;
  presentationMode: CodePresentationMode;
}) {
  const buffer = useEditorStore(
    (s) => s.bufferByWorkspace[workspaceId]?.[relativePath] ?? ""
  );
  const setBuffer = useEditorStore((s) => s.setBuffer);
  const mergeSaved = useEditorStore((s) => s.mergeDiskContent);

  useEffect(() => {
    if (!isActive || presentationMode !== "edit") return;
    const has = useEditorStore.getState().bufferByWorkspace[workspaceId]?.[relativePath];
    if (has !== undefined) return;
    let cancelled = false;
    void invoke<string>("read_workspace_text_file", {
      workspaceRoot,
      relativePath,
    })
      .then((content) => {
        if (!cancelled) mergeSaved(workspaceId, relativePath, content);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isActive, presentationMode, workspaceId, workspaceRoot, relativePath, mergeSaved]);
  const saveFile = useEditorStore((s) => s.saveFile);
  const setNavigationArea = useWorkspaceStore((s) => s.setNavigationArea);
  const setLayoutTargetRuntimeId = useWorkspaceStore((s) => s.setLayoutTargetRuntimeId);

  const language = useMemo(
    () => languageFromRelativePath(relativePath),
    [relativePath]
  );

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      monaco.editor.setTheme("pandora-oc2");

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void saveFile(workspaceId, workspaceRoot, relativePath).catch((e) =>
          console.error("Save failed:", e)
        );
      });

      editor.onDidFocusEditorWidget(() => {
        setLayoutTargetRuntimeId(null);
        setNavigationArea("workspace");
      });
    },
    [workspaceId, workspaceRoot, relativePath, saveFile, setNavigationArea, setLayoutTargetRuntimeId]
  );

  const onChange = useCallback(
    (value: string | undefined) => {
      setBuffer(workspaceId, relativePath, value ?? "");
    },
    [workspaceId, relativePath, setBuffer]
  );

  if (!isActive) {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          visibility: "hidden",
          pointerEvents: "none",
          backgroundColor: PANDORA_EDITOR_BG,
        }}
        aria-hidden
      />
    );
  }

  if (presentationMode === "review") {
    return (
      <ReviewFileViewer
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        relativePath={relativePath}
        isActive={isActive}
      />
    );
  }

  return (
    <div
      className="absolute inset-0 min-h-0"
      style={{ backgroundColor: PANDORA_EDITOR_BG }}
    >
      <Editor
        height="100%"
        path={relativePath}
        language={language}
        value={buffer}
        theme="pandora-oc2"
        loading={editorLoading}
        beforeMount={pandoraMonacoBeforeMount}
        onChange={onChange}
        onMount={handleMount}
        options={editorOptions}
      />
    </div>
  );
}
