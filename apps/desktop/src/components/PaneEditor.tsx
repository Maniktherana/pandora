import { useCallback, useEffect, useMemo } from "react";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { languageFromRelativePath } from "@/lib/editor-language";
import { terminalTheme } from "@/lib/theme";

const EDITOR_BG = terminalTheme.background ?? "#121212";

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

const noDiag = {
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
} as const;

const beforeMount: BeforeMount = (monaco) => {
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(noDiag);
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(noDiag);

  const jd = monaco.json.jsonDefaults;
  jd.setDiagnosticsOptions({ validate: false });
  jd.setModeConfiguration({ ...jd.modeConfiguration, diagnostics: false });

  for (const d of [monaco.css.cssDefaults, monaco.css.scssDefaults, monaco.css.lessDefaults]) {
    d.setModeConfiguration({ ...d.modeConfiguration, diagnostics: false });
  }
  for (const d of [monaco.html.htmlDefaults, monaco.html.handlebarDefaults, monaco.html.razorDefaults]) {
    d.setModeConfiguration({ ...d.modeConfiguration, diagnostics: false });
  }

  monaco.editor.defineTheme("pandora-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": EDITOR_BG,
      "minimap.background": EDITOR_BG,
    },
  });
  monaco.editor.setTheme("pandora-dark");
};

const editorLoading = (
  <div className="h-full w-full" style={{ backgroundColor: EDITOR_BG }} aria-hidden />
);

export default function PaneEditor({
  workspaceId,
  workspaceRoot,
  relativePath,
  isActive,
}: {
  workspaceId: string;
  workspaceRoot: string;
  relativePath: string;
  isActive: boolean;
}) {
  const buffer = useEditorStore(
    (s) => s.bufferByWorkspace[workspaceId]?.[relativePath] ?? ""
  );
  const setBuffer = useEditorStore((s) => s.setBuffer);
  const mergeSaved = useEditorStore((s) => s.mergeDiskContent);

  useEffect(() => {
    if (!isActive) return;
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
  }, [isActive, workspaceId, workspaceRoot, relativePath, mergeSaved]);
  const saveFile = useEditorStore((s) => s.saveFile);
  const setNavigationArea = useWorkspaceStore((s) => s.setNavigationArea);

  const language = useMemo(
    () => languageFromRelativePath(relativePath),
    [relativePath]
  );

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      monaco.editor.setTheme("pandora-dark");

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void saveFile(workspaceId, workspaceRoot, relativePath).catch((e) =>
          console.error("Save failed:", e)
        );
      });

      editor.onDidFocusEditorWidget(() => {
        setNavigationArea("workspace");
      });
    },
    [workspaceId, workspaceRoot, relativePath, saveFile, setNavigationArea]
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
          backgroundColor: EDITOR_BG,
        }}
        aria-hidden
      />
    );
  }

  return (
    <div
      className="absolute inset-0 min-h-0"
      style={{ backgroundColor: EDITOR_BG }}
    >
      <Editor
        height="100%"
        path={relativePath}
        language={language}
        value={buffer}
        theme="pandora-dark"
        loading={editorLoading}
        beforeMount={beforeMount}
        onChange={onChange}
        onMount={handleMount}
        options={editorOptions}
      />
    </div>
  );
}
