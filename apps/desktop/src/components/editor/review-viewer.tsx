import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { Virtualizer, WorkerPoolContextProvider } from "@pierre/diffs/react";
import PierreWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowTurnBackwardIcon,
  FilePlusIcon,
  GitCompareIcon,
  PlusSignIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import type { DiffSource, PrContext } from "@/lib/shared/types";
import { useWorkspaceView } from "@/hooks/use-desktop-view";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { Button } from "@/components/ui/button";
import {
  DIFF_CONTENTS_STALE_TIME_MS,
  diffContentsQueryKey,
  fetchDiffContents,
} from "@/components/editor/diff-data";
import DiffViewer from "@/components/editor/diff-viewer";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getPierreSurfaceStyle, REVIEW_DIFF_METRICS } from "@/components/editor/pierre-pandora";
import {
  useScmPathLineStatsBulkQuery,
  useScmStatusQuery,
} from "@/components/layout/right-sidebar/scm/scm-queries";
import { ScmStatusBadge } from "@/components/layout/right-sidebar/scm/scm-status-badge";
import {
  decorationForScmEntry,
  scmDiscardTracked,
  scmDiscardUntracked,
  scmStage,
  scmUnstage,
} from "@/components/layout/right-sidebar/scm/scm.utils";
import type {
  ScmLineStats,
  ScmStatusEntry,
  TreeScmDecoration,
} from "@/components/layout/right-sidebar/scm/scm.types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/shared/utils";

const STORAGE_SIDE = "pandora.diff.renderSideBySide";
const STORAGE_WRAP = "pandora.diff.wrapLines";

const pierreWorkerFactory = () => new Worker(PierreWorkerUrl, { type: "module" });

const pierreWorkerPoolOptions = { workerFactory: pierreWorkerFactory, poolSize: 4 };
const pierreHighlighterOptions = { theme: "pandora-theme" };
const reviewVirtualizerConfig = {
  overscrollSize: 1000,
  intersectionObserverMargin: 4000,
};

const collapsedSectionStyle: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 44px",
};

const DIFF_BODY_MOUNT_MARGIN_PX = reviewVirtualizerConfig.intersectionObserverMargin;
const MIN_ESTIMATED_DIFF_BODY_HEIGHT = 140;
const MAX_ESTIMATED_DIFF_BODY_HEIGHT = 2200;

type ReviewViewerProps = {
  workspaceId: string;
  workspaceRoot: string;
};

type DiffLayout = "split" | "unified";
type ReviewMode = "unstaged" | "staged" | "branch";
type BranchLabel = {
  source: string;
  target: string;
};

function loadDiffLayout(): DiffLayout {
  if (typeof window === "undefined") return "split";
  return window.localStorage.getItem(STORAGE_SIDE) === "inline" ? "unified" : "split";
}

function loadWrapLines(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_WRAP) === "1";
}

function persistDiffLayout(layout: DiffLayout) {
  try {
    window.localStorage.setItem(STORAGE_SIDE, layout === "split" ? "sideBySide" : "inline");
  } catch {
    /* ignore */
  }
}

function persistWrapLines(wrapLines: boolean) {
  try {
    window.localStorage.setItem(STORAGE_WRAP, wrapLines ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function hasStaged(entry: ScmStatusEntry): boolean {
  return entry.stagedKind != null && entry.stagedKind !== "";
}

function hasUnstaged(entry: ScmStatusEntry): boolean {
  return entry.untracked || (entry.worktreeKind != null && entry.worktreeKind !== "");
}

function sourceForMode(mode: ReviewMode): DiffSource | null {
  if (mode === "staged") return "staged";
  if (mode === "unstaged") return "working";
  return null;
}

function statsKey(path: string, source: DiffSource) {
  return `${source}:${path}`;
}

function splitDisplayPath(path: string): { directory: string; fileName: string } {
  const slashIndex = path.lastIndexOf("/");
  if (slashIndex < 0) {
    return { directory: "", fileName: path };
  }
  return {
    directory: path.slice(0, slashIndex + 1),
    fileName: path.slice(slashIndex + 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function estimateDiffBodyHeight(stats: ScmLineStats | undefined): number {
  const changedLines = Math.max((stats?.added ?? 0) + (stats?.removed ?? 0), 4);
  return clamp(
    (changedLines + 8) * REVIEW_DIFF_METRICS.lineHeight + REVIEW_DIFF_METRICS.hunkSeparatorHeight,
    MIN_ESTIMATED_DIFF_BODY_HEIGHT,
    MAX_ESTIMATED_DIFF_BODY_HEIGHT,
  );
}

function isNearScrollRoot(node: HTMLElement, root: HTMLElement | null, margin: number): boolean {
  const nodeRect = node.getBoundingClientRect();
  const rootRect = root?.getBoundingClientRect() ?? {
    top: 0,
    bottom: typeof window === "undefined" ? 0 : window.innerHeight,
  };
  return nodeRect.bottom >= rootRect.top - margin && nodeRect.top <= rootRect.bottom + margin;
}

function BranchModeLabel({ branchLabel }: { branchLabel: BranchLabel | null }) {
  return (
    <>
      <span>Branch</span>
      <span className="text-[var(--theme-text-subtle)]">·</span>
      <span className="font-mono text-[0.95em]">{branchLabel?.source ?? "current"}</span>
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.5} className="size-3.5 shrink-0" />
      <span className="font-mono text-[0.95em]">{branchLabel?.target ?? "origin/..."}</span>
    </>
  );
}

type ReviewFileEntryProps = {
  entry: ScmStatusEntry;
  source: DiffSource;
  stats: ScmLineStats | undefined;
  decoration: TreeScmDecoration;
  isOpen: boolean;
  canStage: boolean;
  busy: boolean;
  mode: ReviewMode;
  workspaceRoot: string;
  diffLayout: DiffLayout;
  wrapLines: boolean;
  reloadKey: number;
  isFirst: boolean;
  onToggle: (path: string, nextOpen: boolean) => void;
  onOpenFile: (path: string) => void;
  onRevert: (entry: ScmStatusEntry) => void;
  onStage: (entry: ScmStatusEntry) => void;
};

type ReviewDiffBodyProps = {
  entry: ScmStatusEntry;
  source: DiffSource;
  stats: ScmLineStats | undefined;
  workspaceRoot: string;
  diffLayout: DiffLayout;
  wrapLines: boolean;
  reloadKey: number;
};

const ReviewDiffBody = memo(function ReviewDiffBody({
  entry,
  source,
  stats,
  workspaceRoot,
  diffLayout,
  wrapLines,
  reloadKey,
}: ReviewDiffBodyProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [shouldMountDiff, setShouldMountDiff] = useState(false);
  const estimatedHeight = useMemo(() => estimateDiffBodyHeight(stats), [stats]);

  useLayoutEffect(() => {
    if (shouldMountDiff) return;

    const node = bodyRef.current;
    if (!node) return;

    const root = node.closest<HTMLElement>(".pandora-review-scroll-root");
    if (
      typeof IntersectionObserver === "undefined" ||
      isNearScrollRoot(node, root, DIFF_BODY_MOUNT_MARGIN_PX)
    ) {
      setShouldMountDiff(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setShouldMountDiff(true);
        observer.disconnect();
      },
      {
        root,
        rootMargin: `${DIFF_BODY_MOUNT_MARGIN_PX}px 0px ${DIFF_BODY_MOUNT_MARGIN_PX}px 0px`,
      },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldMountDiff]);

  return (
    <div ref={bodyRef} className="border-t border-[var(--theme-code-surface-separator)]">
      {shouldMountDiff ? (
        <DiffViewer
          workspaceRoot={workspaceRoot}
          relativePath={entry.path}
          source={source}
          showHeader={false}
          fillHeight={false}
          diffStyle={diffLayout}
          wrapLines={wrapLines}
          reloadKey={reloadKey}
          metrics={REVIEW_DIFF_METRICS}
        />
      ) : (
        <div
          aria-hidden
          className="bg-[var(--theme-code-surface-base)]"
          style={{ height: estimatedHeight }}
        />
      )}
    </div>
  );
});

const ReviewFileEntry = memo(function ReviewFileEntry({
  entry,
  source,
  stats,
  decoration,
  isOpen,
  canStage,
  busy,
  mode,
  workspaceRoot,
  diffLayout,
  wrapLines,
  reloadKey,
  isFirst,
  onToggle,
  onOpenFile,
  onRevert,
  onStage,
}: ReviewFileEntryProps) {
  const { directory, fileName } = splitDisplayPath(entry.path);

  return (
    <section
      className={cn(
        "group/review-card bg-[var(--theme-code-surface-base)]",
        !isFirst && "border-t border-[var(--theme-code-surface-separator)]",
      )}
      style={!isOpen ? collapsedSectionStyle : undefined}
    >
      <div className="sticky top-0 z-[5] flex items-center gap-2 bg-[var(--theme-code-surface-base)] px-4 py-3 shadow-[0_1px_0_var(--theme-code-surface-separator)]">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onToggle(entry.path, !isOpen)}
        >
          <FileTypeIcon path={entry.path} kind="file" className="size-5" />
          <span
            className="min-w-0 flex-1 truncate text-[12px] text-[var(--theme-text)]"
            title={entry.path}
          >
            {directory ? (
              <span className="text-[var(--theme-text-subtle)]">{directory}</span>
            ) : null}
            <span>{fileName}</span>
          </span>
        </button>
        <div className="pointer-events-none flex items-center gap-0.5 opacity-0 transition-opacity group-hover/review-card:pointer-events-auto group-hover/review-card:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
            title="Open file"
            onClick={() => onOpenFile(entry.path)}
          >
            <HugeiconsIcon icon={FilePlusIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-warning)]"
            title={mode === "staged" ? "Unstage" : "Revert"}
            onClick={() => onRevert(entry)}
            disabled={busy}
          >
            <HugeiconsIcon icon={ArrowTurnBackwardIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
            title="Stage"
            onClick={() => onStage(entry)}
            disabled={busy || !canStage}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
        </div>
        <div className="flex flex-none items-center gap-1.5 whitespace-nowrap text-[11px]">
          {decoration.badge ? (
            <ScmStatusBadge text={decoration.badge} tone={decoration.tone} className="shrink-0" />
          ) : null}
          <span className="shrink-0 text-[var(--theme-scm-added)]">+{stats?.added ?? 0}</span>
          <span className="shrink-0 text-[var(--theme-scm-deleted)]">-{stats?.removed ?? 0}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
          title={isOpen ? "Collapse diff" : "Expand diff"}
          onClick={() => onToggle(entry.path, !isOpen)}
        >
          <HugeiconsIcon
            icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
            strokeWidth={1.5}
            className="size-3.5"
          />
        </Button>
      </div>

      {isOpen ? (
        <ReviewDiffBody
          entry={entry}
          source={source}
          stats={stats}
          workspaceRoot={workspaceRoot}
          diffLayout={diffLayout}
          wrapLines={wrapLines}
          reloadKey={reloadKey}
        />
      ) : null}
    </section>
  );
});

function ReviewViewer({ workspaceId, workspaceRoot }: ReviewViewerProps) {
  const queryClient = useQueryClient();
  const { openFile } = useEditorActions();
  const workspace = useWorkspaceView(workspaceId, (view) => view.workspace);
  const { data: entriesData, refetch, isFetching } = useScmStatusQuery(workspaceRoot);
  const entries = entriesData ?? [];
  const [diffLayout, setDiffLayout] = useState<DiffLayout>(loadDiffLayout);
  const [wrapLines, setWrapLines] = useState(loadWrapLines);
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<ReviewMode>("unstaged");
  const [baseBranchLabel, setBaseBranchLabel] = useState<BranchLabel | null>(null);
  const [openByPath, setOpenByPath] = useState<Record<string, boolean>>({});
  const [busyPath, setBusyPath] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace || workspace.status !== "ready") {
      setBaseBranchLabel(null);
      return;
    }
    let cancelled = false;
    invoke<PrContext>("pr_gather_context", { workspaceId: workspace.id })
      .then((ctx) => {
        if (!cancelled) {
          setBaseBranchLabel({
            source: workspace.gitBranchName,
            target: `origin/${ctx.baseBranch}`,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBaseBranchLabel({
            source: workspace.gitBranchName,
            target: "origin/...",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const filteredEntries = useMemo(() => {
    switch (mode) {
      case "staged":
        return entries.filter(hasStaged);
      case "branch":
        return [] as ScmStatusEntry[];
      default:
        return entries.filter(hasUnstaged);
    }
  }, [entries, mode]);

  const unstagedCount = useMemo(() => entries.filter(hasUnstaged).length, [entries]);
  const stagedCount = useMemo(() => entries.filter(hasStaged).length, [entries]);

  const activeSource = sourceForMode(mode);
  const statPaths = useMemo(() => filteredEntries.map((entry) => entry.path), [filteredEntries]);
  const prefetchPathKey = useMemo(
    () => filteredEntries.map((entry) => entry.path).join("\0"),
    [filteredEntries],
  );
  const untrackedPaths = useMemo(
    () =>
      mode === "unstaged"
        ? filteredEntries.filter((entry) => entry.untracked).map((entry) => entry.path)
        : [],
    [filteredEntries, mode],
  );
  const { data: bulkStats = [] } = useScmPathLineStatsBulkQuery(
    workspaceRoot,
    statPaths,
    activeSource === "staged",
    untrackedPaths,
    { enabled: activeSource !== null },
  );
  const statsByKey = useMemo(
    () =>
      Object.fromEntries(
        bulkStats.map((stat) => [
          statsKey(stat.path, activeSource === "staged" ? "staged" : "working"),
          stat,
        ]),
      ),
    [activeSource, bulkStats],
  );
  const decorationByPath = useMemo(
    () =>
      Object.fromEntries(
        filteredEntries.map((entry) => [entry.path, decorationForScmEntry(entry)]),
      ),
    [filteredEntries],
  );

  useEffect(() => {
    setOpenByPath((current) => {
      const next: Record<string, boolean> = {};
      for (const entry of filteredEntries) {
        next[entry.path] = current[entry.path] ?? true;
      }
      return next;
    });
  }, [filteredEntries]);

  useEffect(() => {
    if (!activeSource || prefetchPathKey.length === 0) return;

    let cancelled = false;
    const queue = prefetchPathKey.split("\0");
    const maxConcurrent = Math.min(4, queue.length);

    const schedule =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (task: () => void) =>
            window.requestIdleCallback(() => {
              task();
            })
        : (task: () => void) => window.setTimeout(task, 32);

    const runWorker = () => {
      if (cancelled) return;
      const nextPath = queue.shift();
      if (!nextPath) return;

      schedule(() => {
        if (cancelled) return;
        const queryKey = diffContentsQueryKey(workspaceRoot, nextPath, activeSource);
        const queryState = queryClient.getQueryState(queryKey);
        if (queryState?.data != null && !queryState.isInvalidated) {
          runWorker();
          return;
        }
        void queryClient
          .prefetchQuery({
            queryKey,
            queryFn: () => fetchDiffContents(workspaceRoot, nextPath, activeSource),
            staleTime: DIFF_CONTENTS_STALE_TIME_MS,
          })
          .finally(() => {
            runWorker();
          });
      });
    };

    for (let index = 0; index < maxConcurrent; index += 1) {
      runWorker();
    }

    return () => {
      cancelled = true;
    };
  }, [activeSource, prefetchPathKey, queryClient, reloadKey, workspaceRoot]);

  const allCollapsed =
    filteredEntries.length > 0 &&
    filteredEntries.every((entry) => openByPath[entry.path] === false);

  const refreshAll = useCallback(async () => {
    await refetch();
    await queryClient.invalidateQueries({ queryKey: ["diff-contents", workspaceRoot] });
    setReloadKey((value) => value + 1);
  }, [queryClient, refetch, workspaceRoot]);

  const runEntryAction = useCallback(
    async (path: string, fn: () => Promise<void>) => {
      setBusyPath(path);
      try {
        await fn();
        await refreshAll();
      } finally {
        setBusyPath(null);
      }
    },
    [refreshAll],
  );

  const handleRevert = useCallback(
    (entry: ScmStatusEntry) => {
      if (mode === "staged") {
        void runEntryAction(entry.path, () => scmUnstage(workspaceRoot, [entry.path]));
        return;
      }

      if (entry.untracked) {
        if (!window.confirm(`Permanently delete untracked "${entry.path}"?`)) return;
        void runEntryAction(entry.path, () => scmDiscardUntracked(workspaceRoot, entry.path));
        return;
      }

      if (!window.confirm(`Discard local changes to "${entry.path}"?`)) return;
      void runEntryAction(entry.path, () => scmDiscardTracked(workspaceRoot, entry.path));
    },
    [mode, runEntryAction, workspaceRoot],
  );

  const handleStage = useCallback(
    (entry: ScmStatusEntry) => {
      if (mode !== "unstaged" || !hasUnstaged(entry)) return;
      void runEntryAction(entry.path, () => scmStage(workspaceRoot, [entry.path]));
    },
    [mode, runEntryAction, workspaceRoot],
  );

  const handleToggleEntry = useCallback(
    (path: string, nextOpen: boolean) => {
      startTransition(() => {
        setOpenByPath((current) => ({ ...current, [path]: nextOpen }));
      });
      if (!nextOpen || !activeSource) return;
      void queryClient.prefetchQuery({
        queryKey: diffContentsQueryKey(workspaceRoot, path, activeSource),
        queryFn: () => fetchDiffContents(workspaceRoot, path, activeSource),
        staleTime: DIFF_CONTENTS_STALE_TIME_MS,
      });
    },
    [activeSource, queryClient, workspaceRoot],
  );

  const handleOpenFile = useCallback(
    (path: string) => {
      void openFile(workspaceId, workspaceRoot, path);
    },
    [openFile, workspaceId, workspaceRoot],
  );

  return (
    <WorkerPoolContextProvider
      poolOptions={pierreWorkerPoolOptions}
      highlighterOptions={pierreHighlighterOptions}
    >
      <div className="flex h-full min-h-0 flex-col" style={getPierreSurfaceStyle()}>
        <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--theme-code-surface-separator)] bg-[var(--theme-code-surface-chrome)] px-1.5 py-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-w-0 gap-1.5 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                />
              }
            >
              <HugeiconsIcon
                icon={GitCompareIcon}
                strokeWidth={1.5}
                className="size-3.5 shrink-0"
              />
              <span className="flex min-w-0 items-center gap-1 truncate">
                {mode === "staged" ? (
                  <span>Staged ({stagedCount})</span>
                ) : mode === "branch" ? (
                  <BranchModeLabel branchLabel={baseBranchLabel} />
                ) : (
                  <span>Unstaged ({unstagedCount})</span>
                )}
              </span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                strokeWidth={1.5}
                className="size-3.5 shrink-0"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-auto min-w-56">
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={(value) => setMode(value as ReviewMode)}
              >
                <DropdownMenuRadioItem value="unstaged">
                  Unstaged ({unstagedCount})
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="staged">Staged ({stagedCount})</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="branch">
                  <span className="flex items-center gap-1">
                    <BranchModeLabel branchLabel={baseBranchLabel} />
                  </span>
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex flex-wrap items-center gap-1">
            <ToggleGroup
              value={[diffLayout]}
              onValueChange={(values) => {
                const value = values[0];
                if (typeof value !== "string") return;
                const next = value === "unified" ? "unified" : "split";
                setDiffLayout(next);
                persistDiffLayout(next);
              }}
              variant="diff"
              size="sm"
              aria-label="Review diff layout"
            >
              <ToggleGroupItem value="split">Split</ToggleGroupItem>
              <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
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
              onClick={() => {
                const next = !wrapLines;
                setWrapLines(next);
                persistWrapLines(next);
              }}
            >
              Line wrap
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
              onClick={() => {
                startTransition(() => {
                  setOpenByPath((current) => ({
                    ...current,
                    ...Object.fromEntries(
                      filteredEntries.map((entry) => [entry.path, allCollapsed]),
                    ),
                  }));
                });
              }}
              disabled={filteredEntries.length === 0}
            >
              {allCollapsed ? "Expand all" : "Collapse all"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
              title="Refresh review"
              onClick={() => void refreshAll()}
              disabled={isFetching}
            >
              <HugeiconsIcon
                icon={Refresh01Icon}
                strokeWidth={1.5}
                className={cn("size-3.5", isFetching && "animate-spin")}
              />
            </Button>
          </div>
        </div>

        {mode === "branch" || entriesData == null || filteredEntries.length === 0 ? (
          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            {mode === "branch" ? (
              <div className="px-2 py-3 text-sm text-[var(--theme-text-subtle)]">
                Branch review is not wired yet.
              </div>
            ) : entriesData == null ? (
              <div className="px-2 py-3 text-sm text-[var(--theme-text-subtle)]">
                Loading review…
              </div>
            ) : (
              <div className="px-2 py-3 text-sm text-[var(--theme-text-subtle)]">
                No {mode === "staged" ? "staged" : "unstaged"} changes to review.
              </div>
            )}
          </div>
        ) : (
          <Virtualizer
            config={reviewVirtualizerConfig}
            className="pandora-review-scroll-root min-h-0 flex-1 overflow-auto"
            contentClassName="bg-[var(--theme-code-surface-base)]"
          >
            {filteredEntries.map((entry, index) => {
              const source = activeSource!;
              const statKey = statsKey(entry.path, source);

              return (
                <ReviewFileEntry
                  key={statKey}
                  entry={entry}
                  source={source}
                  stats={statsByKey[statKey]}
                  decoration={decorationByPath[entry.path]}
                  isOpen={openByPath[entry.path] ?? true}
                  canStage={mode === "unstaged" && hasUnstaged(entry)}
                  busy={busyPath === entry.path}
                  mode={mode}
                  workspaceRoot={workspaceRoot}
                  diffLayout={diffLayout}
                  wrapLines={wrapLines}
                  reloadKey={reloadKey}
                  isFirst={index === 0}
                  onToggle={handleToggleEntry}
                  onOpenFile={handleOpenFile}
                  onRevert={handleRevert}
                  onStage={handleStage}
                />
              );
            })}
          </Virtualizer>
        )}
      </div>
    </WorkerPoolContextProvider>
  );
}

export default memo(ReviewViewer);
