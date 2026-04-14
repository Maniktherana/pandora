import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useEditorStore } from "@/state/editor-store";
import { languageFromRelativePath } from "@/components/editor/editor-language";
import {
  MONACO_THEME_ID,
  pandoraMonacoBeforeMount,
  PANDORA_EDITOR_BG,
  PANDORA_EDITOR_FONT_FAMILY,
  PANDORA_EDITOR_FONT_SIZE,
} from "@/components/editor/monaco-pandora";
import { useSettingsStore, getMonoFont } from "@/state/settings-store";

const LARGE_FILE_BYTES = 500_000;
const HUGE_FILE_BYTES = 2_000_000;
const BUFFER_SYNC_DEBOUNCE_MS = 300;

const editorLoading = (
  <div className="h-full w-full" style={{ backgroundColor: PANDORA_EDITOR_BG }} aria-hidden />
);

export default function PaneEditor({
  workspaceId,
  workspaceRoot,
  relativePath,
  isVisible,
}: {
  workspaceId: string;
  workspaceRoot: string;
  relativePath: string | null;
  isVisible: boolean;
}) {
  const monoFontFamily = useSettingsStore((s) => s.monoFontFamily);
  const monoFontCustom = useSettingsStore((s) => s.monoFontCustom);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const resolvedFont = getMonoFont(monoFontFamily, monoFontCustom);

  const editorOptions = useMemo(
    () => ({
      minimap: { enabled: false },
      fontFamily: resolvedFont || PANDORA_EDITOR_FONT_FAMILY,
      fontSize: editorFontSize || PANDORA_EDITOR_FONT_SIZE,
      lineHeight: Math.round((editorFontSize || PANDORA_EDITOR_FONT_SIZE) * 1.6),
      wordWrap: "off" as const,
      scrollBeyondLastLine: false,
      automaticLayout: false,
      tabSize: 2,
      padding: { top: 8 },
      renderValidationDecorations: "off" as const,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      occurrencesHighlight: "off" as const,
      selectionHighlight: false,
      renderLineHighlight: "gutter" as const,
      bracketPairColorization: { enabled: false },
      guides: { bracketPairs: false, indentation: true },
      stickyScroll: { enabled: false },
      links: false,
      colorDecorators: false,
      matchBrackets: "near" as const,
      foldingStrategy: "indentation" as const,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        useShadows: false,
      },
    }),
    [resolvedFont, editorFontSize],
  );

  // Defer editor mount so workspace/tab switches paint instantly, editor initializes after.
  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEditorReady(true));
    return () => {
      cancelAnimationFrame(id);
      setEditorReady(false);
    };
  }, []);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposablesRef = useRef<Array<{ dispose(): void }>>([]);

  const mergeSaved = useEditorStore((s) => s.mergeDiskContent);
  const workspaceCommands = useWorkspaceActions();

  const currentPathRef = useRef(relativePath);
  currentPathRef.current = relativePath;

  // Load file content from disk if not already in store
  useEffect(() => {
    if (!relativePath) return;
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
  }, [workspaceId, workspaceRoot, relativePath, mergeSaved]);

  // Read initial content non-reactively (only used as defaultValue for first model creation)
  const initialContent = useMemo(() => {
    if (!relativePath) return "";
    return useEditorStore.getState().bufferByWorkspace[workspaceId]?.[relativePath] ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, relativePath]);

  // Safety net: if model was created before content loaded from disk, push content in.
  // Subscribes to a boolean (not the string) so it only re-renders once per file load.
  const isContentLoaded = useEditorStore(
    (s) =>
      !relativePath || s.bufferByWorkspace[workspaceId]?.[relativePath] !== undefined,
  );
  useEffect(() => {
    if (!isContentLoaded || !relativePath) return;
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model || model.getValueLength() > 0) return;
    const content =
      useEditorStore.getState().bufferByWorkspace[workspaceId]?.[relativePath] ?? "";
    if (content) model.setValue(content);
  }, [isContentLoaded, workspaceId, relativePath]);

  const language = useMemo(
    () => (relativePath ? languageFromRelativePath(relativePath) : undefined),
    [relativePath],
  );

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      editorRef.current = editor;
      monaco.editor.setTheme(MONACO_THEME_ID);

      // --- Ctrl+S: read from model directly, not from store ---
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const path = currentPathRef.current;
        if (!path) return;
        const content = editor.getModel()?.getValue();
        if (content === undefined) return;
        void useEditorStore
          .getState()
          .saveFile(workspaceId, workspaceRoot, path, content)
          .catch((e) => console.error("Save failed:", e));
      });

      // --- Focus handler ---
      const focusDisposable = editor.onDidFocusEditorWidget(() => {
        workspaceCommands.setLayoutTargetRuntimeId(null);
        workspaceCommands.setNavigationArea("workspace");
      });

      // --- Content change: mark dirty synchronously, debounce buffer sync ---
      const contentDisposable = editor.onDidChangeModelContent(() => {
        const path = currentPathRef.current;
        if (!path) return;
        // Synchronous dirty flag (cheap, no getValue)
        useEditorStore.getState().markDirty(workspaceId, path);
        // Debounced full content sync for buffer consumers
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const currentContent = editor.getModel()?.getValue();
          if (currentContent !== undefined && currentPathRef.current === path) {
            useEditorStore.getState().setBuffer(workspaceId, path, currentContent);
          }
        }, BUFFER_SYNC_DEBOUNCE_MS);
      });

      // --- Manual resize observer (replaces automaticLayout: true) ---
      let resizeRaf = 0;
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
          if (containerRef.current && editorRef.current) {
            editorRef.current.layout();
          }
        });
      });
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }

      // --- Large file optimizations ---
      const model = editor.getModel();
      if (model) {
        const size = model.getValueLength();
        if (size > HUGE_FILE_BYTES) {
          monaco.editor.setModelLanguage(model, "plaintext");
          editor.updateOptions({ folding: false, wordWrap: "off" });
        } else if (size > LARGE_FILE_BYTES) {
          editor.updateOptions({
            folding: false,
            wordWrap: "off",
            maxTokenizationLineLength: 500,
          });
        }
      }

      disposablesRef.current = [
        focusDisposable,
        contentDisposable,
        { dispose: () => resizeObserver.disconnect() },
        { dispose: () => cancelAnimationFrame(resizeRaf) },
      ];
    },
    [workspaceId, workspaceRoot, workspaceCommands],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const d of disposablesRef.current) d.dispose();
      disposablesRef.current = [];
      if (debounceRef.current) clearTimeout(debounceRef.current);
      editorRef.current = null;
    };
  }, []);

  // Apply large-file optimizations when path (model) changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !relativePath) return;
    // Small delay to let @monaco-editor/react swap the model first
    const id = requestAnimationFrame(() => {
      const model = editor.getModel();
      if (!model) return;
      const size = model.getValueLength();
      if (size > HUGE_FILE_BYTES) {
        const monaco = (window as { monaco?: typeof import("monaco-editor") }).monaco;
        if (monaco) monaco.editor.setModelLanguage(model, "plaintext");
        editor.updateOptions({ folding: false, wordWrap: "off" });
      } else if (size > LARGE_FILE_BYTES) {
        editor.updateOptions({
          folding: false,
          wordWrap: "off",
          maxTokenizationLineLength: 500,
        });
      } else {
        // Reset to defaults for normal files
        editor.updateOptions({
          folding: true,
          maxTokenizationLineLength: 20_000,
        });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [relativePath]);

  if (!relativePath) {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ visibility: "hidden", pointerEvents: "none", backgroundColor: PANDORA_EDITOR_BG }}
        aria-hidden
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 min-h-0"
      style={{
        backgroundColor: PANDORA_EDITOR_BG,
        visibility: isVisible ? "visible" : "hidden",
        pointerEvents: isVisible ? "auto" : "none",
      }}
    >
      {editorReady ? (
        <Editor
          height="100%"
          path={relativePath}
          language={language}
          defaultValue={initialContent}
          theme={MONACO_THEME_ID}
          loading={editorLoading}
          beforeMount={pandoraMonacoBeforeMount}
          onMount={handleMount}
          options={editorOptions}
          keepCurrentModel
        />
      ) : (
        editorLoading
      )}
    </div>
  );
}
