import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
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
import { diffContentsQueryKey, fetchDiffContents } from "@/components/editor/diff-data";
import DiffViewer from "@/components/editor/diff-viewer";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getPierreSurfaceStyle } from "@/components/editor/pierre-pandora";
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
import type { ScmStatusEntry } from "@/components/layout/right-sidebar/scm/scm.types";
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

function BranchModeLabel({ branchLabel }: { branchLabel: BranchLabel | null }) {
  return (
    <>
      <span>Branch</span>
      <span className="text-[var(--theme-text-subtle)]">·</span>
      <span className="font-mono text-[0.95em]">
        {branchLabel?.source ?? "current"}
      </span>
      <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.5} className="size-3.5 shrink-0" />
      <span className="font-mono text-[0.95em]">
        {branchLabel?.target ?? "origin/..."}
      </span>
    </>
  );
}

export default function ReviewViewer({ workspaceId, workspaceRoot }: ReviewViewerProps) {
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
  const untrackedPaths = useMemo(
    () => (mode === "unstaged" ? filteredEntries.filter((entry) => entry.untracked).map((entry) => entry.path) : []),
    [filteredEntries, mode],
  );
  const { data: bulkStats = [], isFetching: isFetchingBulkStats } = useScmPathLineStatsBulkQuery(
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

  useEffect(() => {
    setOpenByPath((current) => {
      const next: Record<string, boolean> = {};
      for (const entry of filteredEntries) {
        next[entry.path] = current[entry.path] ?? false;
      }
      return next;
    });
  }, [filteredEntries]);

  useEffect(() => {
    if (!activeSource || filteredEntries.length === 0) return;

    let cancelled = false;
    const queue = [...filteredEntries];
    const maxConcurrent = Math.min(2, queue.length);

    const schedule =
      typeof window !== "undefined" && "requestIdleCallback" in window
        ? (task: () => void) =>
            window.requestIdleCallback(() => {
              task();
            })
        : (task: () => void) => window.setTimeout(task, 32);

    const runWorker = () => {
      if (cancelled) return;
      const nextEntry = queue.shift();
      if (!nextEntry) return;

      schedule(() => {
        if (cancelled) return;
        void queryClient
          .prefetchQuery({
            queryKey: diffContentsQueryKey(workspaceRoot, nextEntry.path, activeSource),
            queryFn: () => fetchDiffContents(workspaceRoot, nextEntry.path, activeSource),
            staleTime: 30_000,
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
  }, [activeSource, filteredEntries, queryClient, reloadKey, workspaceRoot]);

  const allCollapsed =
    filteredEntries.length > 0 && filteredEntries.every((entry) => openByPath[entry.path] === false);

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
      setOpenByPath((current) => ({ ...current, [path]: nextOpen }));
      if (!nextOpen || !activeSource) return;
      void queryClient.prefetchQuery({
        queryKey: diffContentsQueryKey(workspaceRoot, path, activeSource),
        queryFn: () => fetchDiffContents(workspaceRoot, path, activeSource),
        staleTime: 30_000,
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
            <HugeiconsIcon icon={GitCompareIcon} strokeWidth={1.5} className="size-3.5 shrink-0" />
            <span className="flex min-w-0 items-center gap-1 truncate">
              {mode === "staged" ? (
                <span>Staged ({stagedCount})</span>
              ) : mode === "branch" ? (
                <BranchModeLabel branchLabel={baseBranchLabel} />
              ) : (
                <span>Unstaged ({unstagedCount})</span>
              )}
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.5} className="size-3.5 shrink-0" />
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
            type="single"
            value={diffLayout}
            onValueChange={(value) => {
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
            onClick={() =>
              setOpenByPath((current) => ({
                ...current,
                ...Object.fromEntries(filteredEntries.map((entry) => [entry.path, allCollapsed])),
              }))
            }
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

      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {mode === "branch" ? (
          <div className="px-2 py-3 text-sm text-[var(--theme-text-subtle)]">
            Branch review is not wired yet.
          </div>
        ) : entriesData == null ? (
          <div className="px-2 py-3 text-sm text-[var(--theme-text-subtle)]">Loading review…</div>
        ) : filteredEntries.length === 0 ? (
          <div className="px-2 py-3 text-sm text-[var(--theme-text-subtle)]">
            No {mode === "staged" ? "staged" : "unstaged"} changes to review.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--theme-code-surface-separator)] bg-[var(--theme-code-surface-base)]">
            {filteredEntries.map((entry, index) => {
              const source = activeSource!;
              const statKey = statsKey(entry.path, source);
              const stats = statsByKey[statKey];
              const decoration = decorationForScmEntry(entry);
              const isOpen = openByPath[entry.path] ?? false;
              const canStage = mode === "unstaged" && hasUnstaged(entry);
              const busy = busyPath === entry.path;
              const { directory, fileName } = splitDisplayPath(entry.path);

              return (
                <section
                  key={statKey}
                  className={cn(
                    "group/review-card overflow-hidden bg-[var(--theme-code-surface-base)]",
                    index > 0 && "border-t border-[var(--theme-code-surface-separator)]",
                  )}
                >
                  <div className="flex items-center gap-2 bg-[var(--theme-code-surface-base)] px-4 py-3">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => handleToggleEntry(entry.path, !isOpen)}
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
                        onClick={() => handleOpenFile(entry.path)}
                      >
                        <HugeiconsIcon
                          icon={FilePlusIcon}
                          strokeWidth={1.5}
                          className="size-3.5"
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-warning)]"
                        title={mode === "staged" ? "Unstage" : "Revert"}
                        onClick={() => handleRevert(entry)}
                        disabled={busy}
                      >
                        <HugeiconsIcon
                          icon={ArrowTurnBackwardIcon}
                          strokeWidth={1.5}
                          className="size-3.5"
                        />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
                        title="Stage"
                        onClick={() => handleStage(entry)}
                        disabled={busy || !canStage}
                      >
                        <HugeiconsIcon
                          icon={PlusSignIcon}
                          strokeWidth={1.5}
                          className="size-3.5"
                        />
                      </Button>
                    </div>
                    <div className="flex flex-none items-center gap-1.5 whitespace-nowrap text-[11px]">
                      {decoration.badge ? (
                        <ScmStatusBadge
                          text={decoration.badge}
                          tone={decoration.tone}
                          className="shrink-0"
                        />
                      ) : null}
                      <span className="shrink-0 text-[#D0FDC6]">+{stats?.added ?? 0}</span>
                      <span className="shrink-0 text-[#D9432A]">-{stats?.removed ?? 0}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
                      title={isOpen ? "Collapse diff" : "Expand diff"}
                      onClick={() => handleToggleEntry(entry.path, !isOpen)}
                    >
                      <HugeiconsIcon
                        icon={isOpen ? ArrowDown01Icon : ArrowRight01Icon}
                        strokeWidth={1.5}
                        className="size-3.5"
                      />
                    </Button>
                  </div>

                  {isOpen ? (
                    <div className="border-t border-[var(--theme-code-surface-separator)]">
                      <DiffViewer
                        workspaceRoot={workspaceRoot}
                        relativePath={entry.path}
                        source={source}
                        showHeader={false}
                        fillHeight={false}
                        diffStyle={diffLayout}
                        wrapLines={wrapLines}
                        reloadKey={reloadKey}
                      />
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
