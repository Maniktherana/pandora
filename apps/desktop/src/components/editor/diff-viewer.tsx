import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileDiff as PierreFileDiff } from "@pierre/diffs/react";
import { parseDiffFromFile } from "@pierre/diffs";
import type { FileDiffMetadata, FileDiffOptions, VirtualFileMetrics } from "@pierre/diffs";
import type { DiffSource } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import {
  createPierreDiffOptions,
  createPierreFile,
  getLargeDiffOptions,
  getPierreSurfaceStyle,
} from "@/components/editor/pierre-pandora";
import {
  DIFF_CONTENTS_GC_TIME_MS,
  DIFF_CONTENTS_STALE_TIME_MS,
  diffContentsQueryKey,
  fetchDiffContents,
  type DiffContentsData,
} from "@/components/editor/diff-data";
import { defaultTheme } from "@/lib/theme";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const STORAGE_SIDE = "pandora.diff.renderSideBySide";
const STORAGE_WRAP = "pandora.diff.wrapLines";

type ParsedDiffCacheValue = {
  diffMetadata: FileDiffMetadata | null;
  parseError: string | null;
};

const parsedDiffCache = new WeakMap<DiffContentsData, Map<string, ParsedDiffCacheValue>>();

function loadSideBySide(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(STORAGE_SIDE) !== "inline";
}

function loadWrapLines(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_WRAP) === "1";
}

type PierreDiffStyle = NonNullable<FileDiffOptions<unknown>["diffStyle"]>;

export type DiffViewerStats = {
  additions: number;
  deletions: number;
  hasDiff: boolean;
  loading: boolean;
  error: string | null;
};

export default function DiffViewer({
  workspaceRoot,
  relativePath,
  source,
  isActive = true,
  showHeader = true,
  fillHeight = true,
  className,
  diffStyle: controlledDiffStyle,
  wrapLines: controlledWrapLines,
  reloadKey = 0,
  metrics,
  onStatsChange,
}: {
  workspaceRoot: string;
  relativePath: string;
  source: DiffSource;
  isActive?: boolean;
  showHeader?: boolean;
  fillHeight?: boolean;
  className?: string;
  diffStyle?: PierreDiffStyle;
  wrapLines?: boolean;
  reloadKey?: number;
  metrics?: VirtualFileMetrics;
  onStatsChange?: (stats: DiffViewerStats) => void;
}) {
  const staged = source === "staged";
  const [sideBySide, setSideBySide] = useState(loadSideBySide);
  const [storedWrapLines, setStoredWrapLines] = useState(loadWrapLines);

  const setSideBySidePersist = useCallback((next: boolean) => {
    setSideBySide(next);
    try {
      window.localStorage.setItem(STORAGE_SIDE, next ? "sideBySide" : "inline");
    } catch {
      /* ignore */
    }
  }, []);

  const setWrapLinesPersist = useCallback((next: boolean) => {
    setStoredWrapLines(next);
    try {
      window.localStorage.setItem(STORAGE_WRAP, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const diffQuery = useQuery({
    queryKey: diffContentsQueryKey(workspaceRoot, relativePath, source),
    queryFn: () => fetchDiffContents(workspaceRoot, relativePath, source),
    enabled: isActive,
    staleTime: DIFF_CONTENTS_STALE_TIME_MS,
    gcTime: DIFF_CONTENTS_GC_TIME_MS,
  });

  useEffect(() => {
    if (!isActive || reloadKey === 0) return;
    void diffQuery.refetch();
  }, [diffQuery, isActive, reloadKey]);

  const original = diffQuery.data?.original ?? "";
  const modified = diffQuery.data?.modified ?? "";
  const loading = diffQuery.status === "pending" && diffQuery.data == null;
  const error = diffQuery.error ? String(diffQuery.error) : null;

  const noDiff = !loading && !error && original === modified;
  const diffStyle: PierreDiffStyle =
    controlledDiffStyle ?? (sideBySide ? "split" : "unified");
  const wrapLines = controlledWrapLines ?? storedWrapLines;
  const isLarge = Math.max(original.length, modified.length) > 500_000;

  const parsed = useMemo((): ParsedDiffCacheValue => {
    const data = diffQuery.data;
    if (loading || error || data == null || original === modified) {
      return { diffMetadata: null, parseError: null as string | null };
    }

    const cachedByPath = parsedDiffCache.get(data);
    const cached = cachedByPath?.get(relativePath);
    if (cached) return cached;

    let next: ParsedDiffCacheValue;
    try {
      next = {
        diffMetadata: parseDiffFromFile(
          createPierreFile(relativePath, original),
          createPierreFile(relativePath, modified),
        ),
        parseError: null as string | null,
      };
    } catch (parseError) {
      next = { diffMetadata: null, parseError: String(parseError) };
    }

    if (cachedByPath) {
      cachedByPath.set(relativePath, next);
    } else {
      parsedDiffCache.set(data, new Map([[relativePath, next]]));
    }
    return next;
  }, [diffQuery.data, error, loading, modified, original, relativePath]);

  const diffMetadata = parsed.diffMetadata;
  const displayError = error ?? parsed.parseError;

  const options = useMemo(() => {
    const base = createPierreDiffOptions(diffStyle, wrapLines);
    return isLarge ? { ...base, ...getLargeDiffOptions(diffStyle) } : base;
  }, [diffStyle, isLarge, wrapLines]);

  useEffect(() => {
    if (!onStatsChange) return;
    if (loading) {
      onStatsChange({ additions: 0, deletions: 0, hasDiff: false, loading: true, error: null });
      return;
    }
    if (displayError) {
      onStatsChange({
        additions: 0,
        deletions: 0,
        hasDiff: false,
        loading: false,
        error: displayError,
      });
      return;
    }
    const additions = diffMetadata?.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0) ?? 0;
    const deletions = diffMetadata?.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0) ?? 0;
    onStatsChange({
      additions,
      deletions,
      hasDiff: Boolean(diffMetadata),
      loading: false,
      error: null,
    });
  }, [diffMetadata, displayError, loading, onStatsChange]);

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
      className={cn("flex min-h-0 flex-col", fillHeight && "h-full", className)}
      style={{
        ...getPierreSurfaceStyle(),
        backgroundColor: defaultTheme.codeEditor.surface.base,
      }}
    >
      {showHeader && (
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
          <ToggleGroup
            value={
              diffStyle === "split" || diffStyle === "unified" ? [diffStyle] : []
            }
            onValueChange={(values) => {
              const value = values[0];
              if (typeof value !== "string" || controlledDiffStyle) return;
              setSideBySidePersist(value === "split");
            }}
            variant="diff"
            size="sm"
            className="shrink-0"
            aria-label="Diff layout"
          >
            <ToggleGroupItem value="split" disabled={loading}>
              Split
            </ToggleGroupItem>
            <ToggleGroupItem value="unified" disabled={loading}>
              Unified
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "shrink-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]",
              wrapLines &&
                "border-[var(--theme-code-diff-modified-base)] bg-[var(--theme-code-diff-modified-fill)] text-[var(--theme-text)] hover:bg-[var(--theme-code-diff-modified-fill)]",
            )}
            title={wrapLines ? "Line wrap (on)" : "Line wrap"}
            aria-label={wrapLines ? "Line wrap (on)" : "Line wrap"}
            onClick={() => {
              if (controlledWrapLines !== undefined) return;
              setWrapLinesPersist(!wrapLines);
            }}
            disabled={loading}
          >
            Line wrap
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 shrink-0 p-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            title="Refresh"
            aria-label="Refresh"
            onClick={() => void diffQuery.refetch()}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      )}

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
          <div className="p-3 text-sm text-[var(--theme-text-subtle)]">
            No changes to show for this file.
          </div>
        )}
        {!displayError && !loading && diffMetadata && (
          <PierreFileDiff
            fileDiff={diffMetadata}
            options={options}
            metrics={metrics}
            className="block h-full min-h-full w-full"
          />
        )}
      </div>
    </div>
  );
}
