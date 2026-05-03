import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Virtualizer } from "@pierre/diffs/react";
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
import type { DiffSource } from "@/lib/shared/shared.types";
import { useWorkspaceView } from "@/hooks/use-desktop-view";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { Button } from "@/components/ui/button";
import {
  DIFF_CONTENTS_STALE_TIME_MS,
  diffContentsQueryKey,
  fetchDiffContents,
  type DiffContentsData,
} from "@/components/editor/diff-data";
import {
  parsedDiffQueryKey,
  parseDiffInWorker,
} from "@/lib/services/diff/worker-client";
import { buildRowModel, reviewStatsKey, type ReviewRowData } from "@/components/editor/review-row-model";
import DiffViewer, { type DiffViewerStats } from "@/components/editor/diff-viewer";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getPierreSurfaceStyle, REVIEW_DIFF_METRICS } from "@/components/editor/pierre-pandora";
import { ScmStatusBadge } from "@/components/layout/right-sidebar/scm/scm-status-badge";

import type {
  GitLineStats,
  TreeGitDecoration,
} from "@/lib/services/git/git.types";
import type { ScmEntry } from "@/lib/shared/shared.types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/shared/utils";
import { useReviewNavigationStore } from "@/lib/services/editor/review-navigation";
import { editorReadWorkingCopyText } from "@/lib/services/editor/commands";
import {
  formatTargetBranch,
  resolveWorkspaceTargetBranch,
} from "@/components/layout/right-sidebar/scm/target-branch";
import { useScmStatusCached, scmStatusQueryKey } from "@/lib/services/git/queries";
import { useBranchContext } from "@/lib/services/git/store";
import {
  gitRefresh,
  gitStage,
  gitUnstage,
  gitDiscardTracked,
  gitDiscardUntracked,
} from "@/lib/services/git/commands";

const STORAGE_SIDE = "pandora.diff.renderSideBySide";
const STORAGE_WRAP = "pandora.diff.wrapLines";

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
  isActive?: boolean;
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

function hasUnstaged(entry: ScmEntry): boolean {
  return entry.untracked || (entry.worktreeKind != null && entry.worktreeKind !== "");
}

function sourceForMode(mode: ReviewMode): DiffSource | null {
  if (mode === "branch") return "branch";
  if (mode === "staged") return "staged";
  if (mode === "unstaged") return "working";
  return null;
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

function estimateDiffBodyHeight(stats: GitLineStats | undefined): number {
  const changedLines = Math.max((stats?.added ?? 0) + (stats?.removed ?? 0), 4);
  return clamp(
    (changedLines + 8) * REVIEW_DIFF_METRICS.lineHeight + REVIEW_DIFF_METRICS.hunkSeparatorHeight,
    MIN_ESTIMATED_DIFF_BODY_HEIGHT,
    MAX_ESTIMATED_DIFF_BODY_HEIGHT,
  );
}

function reviewTargetAttr(path: string): string {
  return encodeURIComponent(path);
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
  entry: ScmEntry;
  source: DiffSource;
  stats: GitLineStats | undefined;
  decoration: TreeGitDecoration;
  isOpen: boolean;
  canStage: boolean;
  busy: boolean;
  mode: ReviewMode;
  workspaceId: string;
  workspaceRoot: string;
  diffLayout: DiffLayout;
  wrapLines: boolean;
  reloadKey: number;
  targetBranch?: string | null | undefined;
  isFirst: boolean;
  onToggle: (path: string, nextOpen: boolean) => void;
  onOpenFile: (path: string) => void;
  onRevert: (entry: ScmEntry) => void;
  onStage: (entry: ScmEntry) => void;
  onStatsChange: (path: string, source: DiffSource, stats: GitLineStats) => void;
};

type ReviewDiffBodyProps = {
  path: string;
  source: DiffSource;
  stats: GitLineStats | undefined;
  workspaceId: string;
  workspaceRoot: string;
  diffLayout: DiffLayout;
  wrapLines: boolean;
  reloadKey: number;
  targetBranch?: string | null | undefined;
  onStatsChange: (path: string, source: DiffSource, stats: GitLineStats) => void;
};

const ReviewDiffBody = memo(function ReviewDiffBody({
  path,
  source,
  stats,
  workspaceId,
  workspaceRoot,
  diffLayout,
  wrapLines,
  reloadKey,
  targetBranch,
  onStatsChange,
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

  const handleStatsChange = useCallback(
    (next: DiffViewerStats) => {
      if (!next.loading && !next.error) {
        onStatsChange(path, source, { added: next.additions, removed: next.deletions });
      }
    },
    [path, source, onStatsChange],
  );

  const readWorkingCopy = useCallback(
    (p: string) => editorReadWorkingCopyText(workspaceId, p),
    [workspaceId],
  );

  return (
    <div ref={bodyRef} className="border-t border-[var(--theme-code-surface-separator)]">
      {shouldMountDiff ? (
        <DiffViewer
          workspaceRoot={workspaceRoot}
          relativePath={path}
          source={source}
          showHeader={false}
          fillHeight={false}
          diffStyle={diffLayout}
          wrapLines={wrapLines}
          reloadKey={reloadKey}
          targetBranch={targetBranch}
          metrics={REVIEW_DIFF_METRICS}
          readWorkingCopy={readWorkingCopy}
          onStatsChange={handleStatsChange}
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
  workspaceId,
  workspaceRoot,
  diffLayout,
  wrapLines,
  reloadKey,
  targetBranch,
  isFirst,
  onToggle,
  onOpenFile,
  onRevert,
  onStage,
  onStatsChange,
}: ReviewFileEntryProps) {
  const { directory, fileName } = splitDisplayPath(entry.path);

  return (
    <section
      data-review-path={reviewTargetAttr(entry.path)}
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
        {mode !== "branch" ? (
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
        ) : null}
        <div className="flex flex-none items-center gap-1.5 whitespace-nowrap text-[11px]">
          {decoration.badge ? (
            <ScmStatusBadge text={decoration.badge} tone={decoration.tone} className="shrink-0" />
          ) : null}
          {stats ? (
            <>
              <span className="shrink-0 text-[var(--theme-scm-added)]">+{stats.added}</span>
              <span className="shrink-0 text-[var(--theme-scm-deleted)]">-{stats.removed}</span>
            </>
          ) : null}
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
          path={entry.path}
          source={source}
          stats={stats}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          diffLayout={diffLayout}
          wrapLines={wrapLines}
          reloadKey={reloadKey}
          targetBranch={targetBranch}
          onStatsChange={onStatsChange}
        />
      ) : null}
    </section>
  );
});

const EMPTY_SCM_ENTRIES: ScmEntry[] = [];

function ReviewViewer({ workspaceId, workspaceRoot, isActive = true }: ReviewViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { openFile } = useEditorActions();
  const workspace = useWorkspaceView(workspaceId, (view) => view.workspace);
  const statusData = useScmStatusCached(workspaceId);
  const { branchContext } = useBranchContext(workspaceId);
  const [diffLayout, setDiffLayout] = useState<DiffLayout>(loadDiffLayout);
  const [wrapLines, setWrapLines] = useState(loadWrapLines);
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<ReviewMode>("unstaged");
  const [baseBranchLabel, setBaseBranchLabel] = useState<BranchLabel | null>(null);
  const targetBranch = statusData?.targetBranch ?? null;
  const [openByPath, setOpenByPath] = useState<Record<string, boolean>>({});
  const [loadedStatsByKey, setLoadedStatsByKey] = useState<Record<string, GitLineStats>>({});
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const reviewNavigationRequest = useReviewNavigationStore(
    (state) => state.requestByWorkspaceId[workspaceId] ?? null,
  );
  const clearReviewNavigation = useReviewNavigationStore((state) => state.clearReviewNavigation);

  useEffect(() => {
    if (!workspace || workspace.status !== "ready") {
      setBaseBranchLabel(null);
      return;
    }
    const resolvedTarget = branchContext
      ? resolveWorkspaceTargetBranch(branchContext, targetBranch)
      : targetBranch;
    setBaseBranchLabel({
      source: workspace.gitBranchName,
      target: formatTargetBranch(resolvedTarget),
    });
  }, [workspace, targetBranch, branchContext]);

  const filteredEntries = useMemo(() => {
    switch (mode) {
      case "staged":
        return statusData?.stagedEntries ?? EMPTY_SCM_ENTRIES;
      case "branch":
        return EMPTY_SCM_ENTRIES;
      default:
        return statusData?.unstagedEntries ?? EMPTY_SCM_ENTRIES;
    }
  }, [mode, statusData?.stagedEntries, statusData?.unstagedEntries]);

  const prefetchKey = useMemo(
    () => filteredEntries.map((e) => e.path).join("\0"),
    [filteredEntries],
  );

  const unstagedCount = statusData?.unstagedEntries.length ?? 0;
  const stagedCount = statusData?.stagedEntries.length ?? 0;

  const activeSource = sourceForMode(mode);
  const rowModel = useMemo(
    (): ReviewRowData[] =>
      activeSource ? buildRowModel(filteredEntries, activeSource, loadedStatsByKey) : [],
    [activeSource, filteredEntries, loadedStatsByKey],
  );

  useEffect(() => {
    if (filteredEntries.length === 0) return;
    setOpenByPath((current) => {
      let additions: Record<string, boolean> | null = null;
      for (const entry of filteredEntries) {
        if (!(entry.path in current)) {
          additions ??= {};
          additions[entry.path] = true;
        }
      }
      return additions ? { ...current, ...additions } : current;
    });
  }, [filteredEntries]);

  useEffect(() => {
    setLoadedStatsByKey({});
  }, [workspaceId, mode, targetBranch]);

  const handleDiffStatsChange = useCallback(
    (path: string, source: DiffSource, stats: GitLineStats) => {
      const key = reviewStatsKey(path, source);
      setLoadedStatsByKey((current) => {
        const previous = current[key];
        if (previous?.added === stats.added && previous?.removed === stats.removed) {
          return current;
        }
        return { ...current, [key]: stats };
      });
    },
    [],
  );

  const prefetchTextAndParse = useCallback(
    async (path: string, source: DiffSource) => {
      const textQueryKey = diffContentsQueryKey(workspaceRoot, path, source, targetBranch);
      await queryClient.prefetchQuery({
        queryKey: textQueryKey,
        queryFn: () =>
          fetchDiffContents(workspaceRoot, path, source, targetBranch, (p) =>
            editorReadWorkingCopyText(workspaceId, p),
          ),
        staleTime: DIFF_CONTENTS_STALE_TIME_MS,
      });
      const data = queryClient.getQueryData<DiffContentsData>(textQueryKey);
      if (!data || data.original === data.modified) return;
      await queryClient.prefetchQuery({
        queryKey: parsedDiffQueryKey(workspaceRoot, source, path, targetBranch, data.originalHash, data.modifiedHash),
        queryFn: () =>
          parseDiffInWorker({
            workspaceRoot,
            relativePath: path,
            source,
            targetBranch,
            original: data.original,
            modified: data.modified,
          }),
        staleTime: Infinity,
      });
    },
    [queryClient, workspaceRoot, targetBranch, workspaceId],
  );

  useEffect(() => {
    if (!isActive || !reviewNavigationRequest) return;

    const requestedMode = reviewNavigationRequest.source === "staged" ? "staged" : "unstaged";
    setMode((current) => (current === requestedMode ? current : requestedMode));
    setOpenByPath((current) =>
      current[reviewNavigationRequest.path]
        ? current
        : { ...current, [reviewNavigationRequest.path]: true },
    );

    prefetchTextAndParse(reviewNavigationRequest.path, reviewNavigationRequest.source).catch(
      (error) => {
        console.warn("[ReviewViewer] navigation prefetch failed:", error);
      },
    );
  }, [isActive, prefetchTextAndParse, reviewNavigationRequest]);

  useEffect(() => {
    if (!isActive || !reviewNavigationRequest || statusData == null) return;

    const requestedMode = reviewNavigationRequest.source === "staged" ? "staged" : "unstaged";
    if (mode !== requestedMode) return;

    if (!filteredEntries.some((entry) => entry.path === reviewNavigationRequest.path)) {
      clearReviewNavigation(workspaceId, reviewNavigationRequest.nonce);
      return;
    }

    let cancelled = false;
    let frameId = 0;
    let attempts = 0;

    const scrollToTarget = () => {
      if (cancelled) return;
      const selector = `[data-review-path="${reviewTargetAttr(reviewNavigationRequest.path)}"]`;
      const target = viewerRef.current?.querySelector<HTMLElement>(selector) ?? null;
      if (target) {
        target.scrollIntoView({ block: "start" });
        clearReviewNavigation(workspaceId, reviewNavigationRequest.nonce);
        return;
      }
      if (attempts >= 8) {
        clearReviewNavigation(workspaceId, reviewNavigationRequest.nonce);
        return;
      }
      attempts += 1;
      frameId = window.requestAnimationFrame(scrollToTarget);
    };

    frameId = window.requestAnimationFrame(scrollToTarget);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [
    isActive,
    clearReviewNavigation,
    statusData,
    filteredEntries,
    mode,
    reviewNavigationRequest,
    workspaceId,
  ]);

  useEffect(() => {
    if (!isActive || !activeSource || prefetchKey.length === 0) return;

    let cancelled = false;
    const queue = prefetchKey.split("\0");
    const maxConcurrent = Math.min(4, queue.length);

    const schedule =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (task: () => void) =>
            window.requestIdleCallback(() => {
              task();
            })
        : (task: () => void) => window.setTimeout(task, 32);

    const readWorkingCopy = (path: string) => editorReadWorkingCopyText(workspaceId, path);

    const runWorker = () => {
      if (cancelled) return;
      const nextPath = queue.shift();
      if (!nextPath) return;

      schedule(() => {
        if (cancelled) return;
        const queryKey = diffContentsQueryKey(workspaceRoot, nextPath, activeSource, targetBranch);
        const queryState = queryClient.getQueryState(queryKey);
        const cachedData = queryState?.data as DiffContentsData | undefined;
        if (cachedData != null && !queryState?.isInvalidated) {
          if (cachedData.original !== cachedData.modified) {
            queryClient
              .prefetchQuery({
                queryKey: parsedDiffQueryKey(
                  workspaceRoot,
                  activeSource,
                  nextPath,
                  targetBranch,
                  cachedData.originalHash,
                  cachedData.modifiedHash,
                ),
                queryFn: () =>
                  parseDiffInWorker({
                    workspaceRoot,
                    relativePath: nextPath,
                    source: activeSource,
                    targetBranch,
                    original: cachedData.original,
                    modified: cachedData.modified,
                  }),
                staleTime: Infinity,
              })
              .catch((error) => {
                console.warn("[ReviewViewer] idle parse prefetch failed:", error);
              });
          }
          runWorker();
          return;
        }
        queryClient
          .prefetchQuery({
            queryKey,
            queryFn: () =>
              fetchDiffContents(
                workspaceRoot,
                nextPath,
                activeSource,
                targetBranch,
                readWorkingCopy,
              ),
            staleTime: DIFF_CONTENTS_STALE_TIME_MS,
          })
          .then(() => {
            const data = queryClient.getQueryData<DiffContentsData>(queryKey);
            if (!data || data.original === data.modified) return;
            queryClient
              .prefetchQuery({
                queryKey: parsedDiffQueryKey(
                  workspaceRoot,
                  activeSource,
                  nextPath,
                  targetBranch,
                  data.originalHash,
                  data.modifiedHash,
                ),
                queryFn: () =>
                  parseDiffInWorker({
                    workspaceRoot,
                    relativePath: nextPath,
                    source: activeSource,
                    targetBranch,
                    original: data.original,
                    modified: data.modified,
                  }),
                staleTime: Infinity,
              })
              .catch((error) => {
                console.warn("[ReviewViewer] idle parse prefetch failed:", error);
              });
          })
          .catch((error) => {
            console.warn("[ReviewViewer] idle prefetch failed:", error);
          })
          .finally(() => {
            runWorker();
          });
      });
    };

    // Delay worker start until after first paint so initial Review mount is not
    // blocked by prefetch setup.  schedule() already defers individual fetches
    // via requestIdleCallback/setTimeout, but this outer defer ensures the
    // first render cycle completes before any workers are spawned.
    const startTimeout = window.setTimeout(() => {
      for (let index = 0; index < maxConcurrent; index += 1) {
        runWorker();
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimeout);
    };
  }, [
    isActive,
    activeSource,
    prefetchKey,
    queryClient,
    reloadKey,
    targetBranch,
    workspaceId,
    workspaceRoot,
  ]);

  const allCollapsed =
    rowModel.length > 0 && rowModel.every((row) => openByPath[row.entry.path] === false);

  const refreshAll = useCallback(async () => {
    gitRefresh(workspaceId);
    await queryClient.invalidateQueries({ queryKey: ["diff-contents", workspaceRoot] });
    await queryClient.invalidateQueries({ queryKey: scmStatusQueryKey(workspaceId) });
    setReloadKey((value) => value + 1);
  }, [queryClient, workspaceId, workspaceRoot]);

  const handleRefreshClick = useCallback(() => {
    refreshAll().catch((error) => {
      console.warn("[ReviewViewer] refresh failed:", error);
    });
  }, [refreshAll]);

  const runEntryAction = useCallback(
    (path: string, fn: () => void) => {
      setBusyPath(path);
      try {
        fn();
      } finally {
        setBusyPath(null);
      }
    },
    [],
  );

  const handleRevert = useCallback(
    (entry: ScmEntry) => {
      if (mode === "staged") {
        runEntryAction(entry.path, () => gitUnstage(workspaceId, [entry.path]));
        return;
      }

      if (entry.untracked) {
        if (!window.confirm(`Permanently delete untracked "${entry.path}"?`)) return;
        runEntryAction(entry.path, () => gitDiscardUntracked(workspaceId, [entry.path]));
        return;
      }

      if (!window.confirm(`Discard local changes to "${entry.path}"?`)) return;
      runEntryAction(entry.path, () => gitDiscardTracked(workspaceId, [entry.path]));
    },
    [mode, runEntryAction, workspaceId],
  );

  const handleStage = useCallback(
    (entry: ScmEntry) => {
      if (mode !== "unstaged" || !hasUnstaged(entry)) return;
      runEntryAction(entry.path, () => gitStage(workspaceId, [entry.path]));
    },
    [mode, runEntryAction, workspaceId],
  );

  const handleToggleEntry = useCallback(
    (path: string, nextOpen: boolean) => {
      // Synchronous UI update — expand/collapse is direct user intent, no deferral needed.
      setOpenByPath((current) => ({ ...current, [path]: nextOpen }));
      if (!nextOpen || !activeSource) return;
      prefetchTextAndParse(path, activeSource).catch((error) => {
        console.warn("[ReviewViewer] entry prefetch failed:", error);
      });
    },
    [activeSource, prefetchTextAndParse],
  );

  const handleOpenFile = useCallback(
    (path: string) => {
      openFile(workspaceId, workspaceRoot, path).catch((error) => {
        console.warn("[ReviewViewer] open file failed:", error);
      });
    },
    [openFile, workspaceId, workspaceRoot],
  );

  return (
    <div ref={viewerRef} className="flex h-full min-h-0 flex-col" style={getPierreSurfaceStyle()}>
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
                // Synchronous UI update — expand/collapse all is direct user intent, no deferral.
                setOpenByPath((current) => ({
                  ...current,
                  ...Object.fromEntries(
                    filteredEntries.map((entry) => [entry.path, allCollapsed]),
                  ),
                }));
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
              onClick={handleRefreshClick}
            >
              <HugeiconsIcon
                icon={Refresh01Icon}
                strokeWidth={1.5}
                className="size-3.5"
              />
            </Button>
          </div>
        </div>

        {statusData == null || rowModel.length === 0 ? (
          <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
            {statusData == null ? (
              <div className="px-2 py-3 text-sm text-[var(--theme-text-subtle)]">
                Loading review…
              </div>
            ) : (
              <div className="px-2 py-3 text-sm text-[var(--theme-text-subtle)]">
                No {mode === "branch" ? "branch" : mode === "staged" ? "staged" : "unstaged"}{" "}
                changes to review.
              </div>
            )}
          </div>
        ) : (
          <Virtualizer
            config={reviewVirtualizerConfig}
            className="pandora-review-scroll-root min-h-0 flex-1 overflow-auto"
            contentClassName="bg-[var(--theme-code-surface-base)]"
          >
            {rowModel.map((row, index) => (
              <ReviewFileEntry
                key={row.statsKey}
                entry={row.entry}
                source={activeSource!}
                stats={row.stats}
                decoration={row.decoration}
                isOpen={openByPath[row.entry.path] ?? true}
                canStage={mode === "unstaged" && hasUnstaged(row.entry)}
                busy={busyPath === row.entry.path}
                mode={mode}
                workspaceId={workspaceId}
                workspaceRoot={workspaceRoot}
                diffLayout={diffLayout}
                wrapLines={wrapLines}
                reloadKey={reloadKey}
                targetBranch={targetBranch}
                isFirst={index === 0}
                onToggle={handleToggleEntry}
                onOpenFile={handleOpenFile}
                onRevert={handleRevert}
                onStage={handleStage}
                onStatsChange={handleDiffStatsChange}
              />
            ))}
          </Virtualizer>
        )}
    </div>
  );
}

export default memo(ReviewViewer);
