import { useCallback, useEffect, useMemo, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { languageFromRelativePath } from "@/lib/editor/editor-language";
import { pandoraMonacoBeforeMount, PANDORA_EDITOR_BG } from "@/lib/editor/monaco-pandora";
import type { DiffSource } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { readWorkspaceTextFile, scmReadGitBlob } from "@/lib/workspace/scm";
import { AlertCircle, Columns2, Eraser, RefreshCw, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_SIDE = "pandora.diff.renderSideBySide";
const STORAGE_TRIM = "pandora.diff.ignoreTrimWhitespace";

function loadSideBySide(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_SIDE) !== "inline";
}

function loadIgnoreTrim(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_TRIM) === "1";
}

const diffLoading = (
  <div className="h-full w-full" style={{ backgroundColor: PANDORA_EDITOR_BG }} aria-hidden />
);

export default function DiffViewer({
  workspaceRoot,
  relativePath,
  source,
  isActive = true,
}: {
  workspaceRoot: string;
  relativePath: string;
  source: DiffSource;
  /** Avoid mounting Monaco when the tab is hidden (saves memory). */
  isActive?: boolean;
}) {
  const staged = source === "staged";
  const language = useMemo(() => languageFromRelativePath(relativePath), [relativePath]);

  const [original, setOriginal] = useState("");
  const [modified, setModified] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sideBySide, setSideBySide] = useState(loadSideBySide);
  const [ignoreTrimWhitespace, setIgnoreTrimWhitespace] = useState(loadIgnoreTrim);

  const setSideBySidePersist = useCallback((next: boolean) => {
    setSideBySide(next);
    try {
      window.localStorage.setItem(STORAGE_SIDE, next ? "sideBySide" : "inline");
    } catch {
      /* ignore */
    }
  }, []);

  const setIgnoreTrimPersist = useCallback((next: boolean) => {
    setIgnoreTrimWhitespace(next);
    try {
      window.localStorage.setItem(STORAGE_TRIM, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (staged) {
        const [headText, indexText] = await Promise.all([
          scmReadGitBlob(workspaceRoot, relativePath, "head"),
          scmReadGitBlob(workspaceRoot, relativePath, "index"),
        ]);
        setOriginal(headText);
        setModified(indexText);
      } else {
        const headText = await scmReadGitBlob(workspaceRoot, relativePath, "head");
        let workText = "";
        try {
          workText = await readWorkspaceTextFile(workspaceRoot, relativePath);
        } catch {
          workText = "";
        }
        setOriginal(headText);
        setModified(workText);
      }
    } catch (e) {
      setError(String(e));
      setOriginal("");
      setModified("");
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot, relativePath, staged]);

  useEffect(() => {
    if (!isActive) return;
    void load();
  }, [isActive, load]);

  const diffOptions = useMemo(
    () => ({
      readOnly: true,
      minimap: { enabled: false },
      fontSize: 13,
      wordWrap: "off" as const,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      padding: { top: 8 },
      folding: true,
      foldingStrategy: "auto" as const,
      glyphMargin: true,
      lineNumbers: "on" as const,
      renderSideBySide: sideBySide,
      enableSplitViewResizing: true,
      ignoreTrimWhitespace,
      renderOverviewRuler: true,
      diffAlgorithm: "advanced" as const,
      renderValidationDecorations: "off" as const,
    }),
    [sideBySide, ignoreTrimWhitespace]
  );

  const onMountDiff = useCallback<DiffOnMount>((_editor, monaco) => {
    monaco.editor.setTheme("pandora-dark");
  }, []);

  if (!isActive) {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ backgroundColor: PANDORA_EDITOR_BG }}
        aria-hidden
      />
    );
  }

  const noDiff = !loading && !error && original === modified;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ backgroundColor: PANDORA_EDITOR_BG }}>
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-800 px-1.5 py-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-500"
          title={relativePath}
        >
          {relativePath}
        </span>
        <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
          {staged ? "Staged" : "Working tree"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-100",
            sideBySide && "bg-neutral-800 text-neutral-200"
          )}
          title={sideBySide ? "Side-by-side (on)" : "Side-by-side"}
          onClick={() => setSideBySidePersist(true)}
          disabled={loading}
        >
          <Columns2 className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-100",
            !sideBySide && "bg-neutral-800 text-neutral-200"
          )}
          title={!sideBySide ? "Inline / unified (on)" : "Inline / unified"}
          onClick={() => setSideBySidePersist(false)}
          disabled={loading}
        >
          <Rows3 className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-100",
            ignoreTrimWhitespace && "bg-neutral-800 text-neutral-200"
          )}
          title={
            ignoreTrimWhitespace
              ? "Ignore trim whitespace (on)"
              : "Ignore trim whitespace"
          }
          onClick={() => setIgnoreTrimPersist(!ignoreTrimWhitespace)}
          disabled={loading}
        >
          <Eraser className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-100"
          title="Refresh"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {error && (
          <div className="flex items-start gap-2 p-3 text-sm text-red-300/90">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {!error && loading && (
          <div className="p-3 text-sm text-neutral-500">Loading diff…</div>
        )}
        {!error && !loading && noDiff && (
          <div className="p-3 text-sm text-neutral-500">No changes to show for this file.</div>
        )}
        {!error && !loading && !noDiff && (
          <DiffEditor
            height="100%"
            theme="pandora-dark"
            language={language}
            original={original}
            modified={modified}
            originalModelPath={`pandora-diff://original/${relativePath}`}
            modifiedModelPath={`pandora-diff://modified/${relativePath}`}
            loading={diffLoading}
            beforeMount={pandoraMonacoBeforeMount}
            onMount={onMountDiff}
            options={diffOptions}
          />
        )}
      </div>
    </div>
  );
}
