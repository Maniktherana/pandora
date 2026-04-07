import { useCallback, useEffect, useMemo, useState } from "react";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffOptions } from "@pierre/diffs";
import type { DiffSource } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { readWorkspaceTextFile, scmReadGitBlob } from "@/components/layout/right-sidebar/scm/scm.utils";
import {
  createPierreDiffOptions,
  createPierreFile,
  getLargeDiffOptions,
  getPierreSurfaceStyle,
} from "@/components/editor/pierre-pandora";
import { defaultTheme } from "@/lib/theme/themes";
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

type PierreDiffStyle = NonNullable<FileDiffOptions<unknown>["diffStyle"]>;

export default function DiffViewer({
  workspaceRoot,
  relativePath,
  source,
  isActive = true,
}: {
  workspaceRoot: string;
  relativePath: string;
  source: DiffSource;
  isActive?: boolean;
}) {
  const staged = source === "staged";
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
  }, [relativePath, staged, workspaceRoot]);

  useEffect(() => {
    if (!isActive) return;
    void load();
  }, [isActive, load]);

  const noDiff = !loading && !error && original === modified;
  const diffStyle: PierreDiffStyle = sideBySide ? "split" : "unified";
  const isLarge = Math.max(original.length, modified.length) > 500_000;

  const parsed = useMemo(() => {
    if (loading || error || original === modified) {
      return { diffMetadata: null, parseError: null as string | null };
    }
    try {
      return {
        diffMetadata: parseDiffFromFile(
          createPierreFile(relativePath, original),
          createPierreFile(relativePath, modified),
          ignoreTrimWhitespace ? { ignoreWhitespace: true } : undefined
        ),
        parseError: null as string | null,
      };
    } catch (parseError) {
      return { diffMetadata: null, parseError: String(parseError) };
    }
  }, [error, ignoreTrimWhitespace, loading, modified, original, relativePath]);

  const diffMetadata = parsed.diffMetadata;
  const displayError = error ?? parsed.parseError;

  const options = useMemo(() => {
    const base = createPierreDiffOptions(diffStyle);
    return isLarge ? { ...base, ...getLargeDiffOptions(diffStyle) } : base;
  }, [diffStyle, isLarge]);

  if (!isActive) {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ backgroundColor: defaultTheme.codeEditor.surface.base }}
        aria-hidden
      />
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{
        ...getPierreSurfaceStyle(),
        backgroundColor: defaultTheme.codeEditor.surface.base,
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--theme-code-surface-separator)] bg-[var(--theme-code-surface-chrome)] px-1.5 py-1">
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--theme-text-subtle)]"
          title={relativePath}
        >
          {relativePath}
        </span>
        {staged ? (
          <span className="shrink-0 rounded bg-[var(--theme-panel-elevated)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--theme-text-muted)]">
            Staged
          </span>
        ) : null}
        {isLarge && (
          <span className="shrink-0 rounded bg-[var(--theme-panel-elevated)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--theme-warning)]">
            Large diff
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 w-7 shrink-0 p-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
            sideBySide && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]"
          )}
          title={sideBySide ? "Split diff (on)" : "Split diff"}
          aria-label={sideBySide ? "Split diff (on)" : "Split diff"}
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
            "h-7 w-7 shrink-0 p-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
            !sideBySide && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]"
          )}
          title={!sideBySide ? "Unified diff (on)" : "Unified diff"}
          aria-label={!sideBySide ? "Unified diff (on)" : "Unified diff"}
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
            "h-7 w-7 shrink-0 p-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
            ignoreTrimWhitespace && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]"
          )}
          title={
            ignoreTrimWhitespace
              ? "Ignore whitespace (on)"
              : "Ignore whitespace"
          }
          aria-label={
            ignoreTrimWhitespace
              ? "Ignore whitespace (on)"
              : "Ignore whitespace"
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
          className="h-7 w-7 shrink-0 p-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          title="Refresh"
          aria-label="Refresh"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {displayError && (
          <div className="flex items-start gap-2 p-3 text-sm text-[var(--theme-error)]">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{displayError}</span>
          </div>
        )}
        {!displayError && loading && (
          <div className="p-3 text-sm text-[var(--theme-text-subtle)]">Loading diff…</div>
        )}
        {!displayError && !loading && noDiff && (
          <div className="p-3 text-sm text-[var(--theme-text-subtle)]">No changes to show for this file.</div>
        )}
        {!displayError && !loading && diffMetadata && (
          <PierreFileDiff
            fileDiff={diffMetadata}
            options={options}
            className="block h-full min-h-full w-full"
          />
        )}
      </div>
    </div>
  );
}
