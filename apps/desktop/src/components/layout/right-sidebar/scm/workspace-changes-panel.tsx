import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  FilePlusIcon,
  GitCompareIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useWorkspaceView } from "@/hooks/use-desktop-view";
import { useTerminalScopeStore } from "@/lib/services/terminal/store";
import { useLayoutStore } from "@/lib/services/layout/store";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useBranchContext } from "@/lib/services/git/store";
import {
  useScmStatusCached,
  scmStatusQueryKey,
  applyOptimisticEntriesToStatus,
  type ScmStatusData,
} from "@/lib/services/git/queries";
import {
  optimisticallyStageEntries,
  optimisticallyUnstageEntries,
  optimisticallyStageAllEntries,
  optimisticallyUnstageAllEntries,
} from "@/lib/services/git/utils";
import {
  gitRefresh,
  gitStage,
  gitStageAll,
  gitUnstage,
  gitUnstageAll,
  gitDiscardTracked,
  gitDiscardUntracked,
  gitCommit,
  gitPush,
  gitFetch,
  gitPull,
  gitSetTargetBranch,
  gitLoadBranchContext,
} from "@/lib/services/git/commands";
import type { GitSelectionModifiers } from "@/lib/services/git/git.types";
import type { ScmEntry } from "@/lib/shared/shared.types";
import {
  composePrInstruction,
  findAgentTerminal,
  gatherPrContext,
} from "@/components/layout/right-sidebar/scm/pr.utils";
import { projectTerminalKey } from "@/lib/services/terminal/project-key";
import { getAllLeaves } from "@/lib/shared/utils";
import { StagedChangesSection } from "./staged-changes-section";
import { UnstagedChangesSection } from "./unstaged-changes-section";
import { CommitDropdown } from "./commit-dropdown";
import { ChecksPanel } from "./checks-panel";
import { GIT_SECTION_STICKY_Z_INDEX_BASE } from "@/lib/services/git/git.types";
import DotGridLoader from "@/components/dot-grid-loader";
import type { DiffSource } from "@/lib/shared/shared.types";
import { requestReviewNavigation } from "@/lib/services/editor/review-navigation";
import { formatTargetBranch, resolveWorkspaceTargetBranch } from "./target-branch";

type WorkspaceChangesPanelProps = {
  workspaceRoot: string;
  workspaceId: string;
  workspaceLabel: string;
};

const EMPTY_ENTRIES: ScmEntry[] = [];
const EMPTY_PENDING: ReadonlySet<string> = new Set<string>();

export default function WorkspaceChangesPanel({
  workspaceRoot,
  workspaceId,
  workspaceLabel,
}: WorkspaceChangesPanelProps) {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [prError, setPrError] = useState<string | null>(null);
  const [prSending, setPrSending] = useState(false);
  const [gitTab, setGitTab] = useState<"changes" | "checks">("changes");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [targetBranch, setTargetBranch] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  /**
   * Paths with an in-flight IPC call. Does NOT block visual movement — rows
   * move immediately via the optimistic cache update. Pending only dims
   * buttons/rows until the IPC settles and finally{} clears this set.
   */
  const [inflightPaths, setInflightPaths] = useState<ReadonlySet<string>>(EMPTY_PENDING);
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);

  // React Query cache, written by applyGitSnapshot in git events.
  const statusData = useScmStatusCached(workspaceId);
  const queryClient = useQueryClient();

  // Branch context still lives in the GitStore (not part of ScmStatusData).
  const { branchContext, branchContextLoading } = useBranchContext(workspaceId);

  // Derived lists from the React Query cache.
  const snapshot = statusData?.snapshot ?? null;
  const entries = statusData?.entries ?? EMPTY_ENTRIES;
  const stagedList = statusData?.stagedEntries ?? EMPTY_ENTRIES;
  const unstagedList = statusData?.unstagedEntries ?? EMPTY_ENTRIES;

  const { openFile } = useEditorActions();
  const layoutCommands = useLayoutActions();
  const terminalCommands = useTerminalActions();
  const workspaceCommands = useWorkspaceActions();
  const workspace = useWorkspaceView(workspaceId, (view) => view.workspace);
  const projectTerminalId = workspace ? projectTerminalKey(workspace.projectId) : null;

  // Stable visible-path arrays for range-select; recomputed only when the list changes.
  const stagedVisiblePaths = useMemo(
    () => stagedList.map((e) => e.path),
    [stagedList],
  );
  const unstagedVisiblePaths = useMemo(
    () => unstagedList.map((e) => e.path),
    [unstagedList],
  );

  // Sync targetBranch from snapshot on first arrival.
  useEffect(() => {
    if (snapshot?.targetBranch !== undefined) {
      setTargetBranch((current) => current ?? snapshot?.targetBranch ?? null);
    }
  }, [snapshot?.targetBranch]);

  // Reset per-workspace UI state on workspace switch.
  useEffect(() => {
    setSelectedPaths([]);
    setLastSelectedPath(null);
    setInflightPaths(EMPTY_PENDING);
  }, [workspaceId]);

  // Drop selected paths that no longer exist in the server list.
  useEffect(() => {
    if (!entries.length) return;
    const existingPaths = new Set(entries.map((entry) => entry.path));
    setSelectedPaths((current) => current.filter((path) => existingPaths.has(path)));
    setLastSelectedPath((current) => (current && existingPaths.has(current) ? current : null));
  }, [entries]);

  // Clear busy when snapshot confirms a commit completed (staged list goes empty).
  useEffect(() => {
    if (busy && snapshot && stagedList.length === 0) {
      setBusy(false);
    }
  }, [busy, snapshot, stagedList.length]);

  useEffect(() => {
    if (!branchPickerOpen) setBranchSearch("");
  }, [branchPickerOpen]);

  useEffect(() => {
    if (!branchContext) return;
    setTargetBranch((current) =>
      resolveWorkspaceTargetBranch(
        branchContext,
        current ?? snapshot?.targetBranch ?? null,
      ),
    );
  }, [branchContext, snapshot?.targetBranch]);

  const branchOptions = useMemo(() => {
    const currentBranch = branchContext?.currentBranch ?? "";
    const options = Array.from(new Set(branchContext?.availableBranches ?? []));
    return options
      .filter(
        (branch) =>
          branch && branch !== "origin" && (branch === "main" || branch !== currentBranch),
      )
      .sort((a, b) => {
        if (a === "main") return -1;
        if (b === "main") return 1;
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      });
  }, [branchContext?.availableBranches, branchContext?.currentBranch]);

  const filteredBranchOptions = useMemo(() => {
    const query = branchSearch.trim().toLowerCase();
    if (!query) return branchOptions;
    return branchOptions.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchOptions, branchSearch]);

  const activeTargetBranch = targetBranch ?? branchContext?.defaultTargetBranch ?? null;

  const handleBranchPickerOpenChange = useCallback(
    (open: boolean) => {
      setBranchPickerOpen(open);
      if (open) gitLoadBranchContext(workspaceId);
    },
    [workspaceId],
  );

  /**
   * Select a new base branch. Optimistically sets local state immediately, then
   * awaits the IPC call and rolls back on failure.
   */
  const handleSelectTargetBranch = useCallback(
    async (branch: string) => {
      setTargetBranch(branch);
      setBranchPickerOpen(false);
      setBranchSearch("");
      try {
        await gitSetTargetBranch(workspaceId, branch);
      } catch (error) {
        setLoadError(String(error));
        setTargetBranch(snapshot?.targetBranch ?? null);
      }
    },
    [workspaceId, snapshot?.targetBranch],
  );

  // ---------------------------------------------------------------------------
  // Optimistic cache helpers
  // ---------------------------------------------------------------------------

  /** Immediately mutate the React Query status cache with an optimistic entry list. */
  const applyOptimistic = useCallback(
    (transform: (currentEntries: ScmEntry[]) => ScmEntry[]) => {
      queryClient.setQueryData(
        scmStatusQueryKey(workspaceId),
        (old: ScmStatusData | undefined) => {
          if (!old) return old;
          return applyOptimisticEntriesToStatus(old, transform(old.entries));
        },
      );
    },
    [queryClient, workspaceId],
  );

  const addInflightPaths = useCallback((paths: string[]) => {
    setInflightPaths((prev) => new Set([...prev, ...paths]));
  }, []);

  const removeInflightPaths = useCallback((paths: string[]) => {
    setInflightPaths((prev) => {
      const next = new Set(prev);
      paths.forEach((p) => next.delete(p));
      return next;
    });
  }, []);

  /**
   * On failure only: ask the backend for a fresh snapshot so the cache reverts
   * to true server state, replacing any lingering optimistic data.
   * Never called on the success path — the backend snapshot event
   * (applyGitSnapshot → queryClient.setQueryData) reconciles the cache
   * without any additional work.
   */
  const reconcileScmAfterFailedAction = useCallback(async () => {
    await gitRefresh(workspaceId);
  }, [workspaceId]);

  // ---------------------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------------------

  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedStagedPaths = useMemo(
    () => stagedList.filter((e) => selectedPathSet.has(e.path)).map((e) => e.path),
    [selectedPathSet, stagedList],
  );
  const selectedUnstagedPaths = useMemo(
    () => unstagedList.filter((e) => selectedPathSet.has(e.path)).map((e) => e.path),
    [selectedPathSet, unstagedList],
  );
  const canCommit = stagedList.length > 0 && commitMessage.trim().length > 0 && !busy;

  const selectEntry = useCallback(
    (path: string, visiblePaths: string[], modifiers: GitSelectionModifiers) => {
      const isRangeSelect = modifiers.shiftKey;
      const isToggleSelect = modifiers.metaKey || modifiers.ctrlKey;
      if (!isRangeSelect && !isToggleSelect) {
        setSelectedPaths([path]);
        setLastSelectedPath(path);
        return false;
      }

      setSelectedPaths((current) => {
        if (isRangeSelect) {
          const anchor =
            lastSelectedPath && visiblePaths.includes(lastSelectedPath) ? lastSelectedPath : path;
          const anchorIndex = visiblePaths.indexOf(anchor);
          const pathIndex = visiblePaths.indexOf(path);
          const start = Math.min(anchorIndex, pathIndex);
          const end = Math.max(anchorIndex, pathIndex);
          const range = visiblePaths.slice(start, end + 1);
          if (isToggleSelect) {
            return Array.from(new Set([...current, ...range]));
          }
          return range;
        }

        if (current.includes(path)) {
          return current.filter((selectedPath) => selectedPath !== path);
        }
        return [...current, path];
      });
      setLastSelectedPath(path);
      return true;
    },
    [lastSelectedPath],
  );

  const onOpenReview = () => {
    layoutCommands.addReviewTab();
  };

  const onOpenReviewPath = useCallback(
    (path: string, source: DiffSource) => {
      requestReviewNavigation(workspaceId, path, source);
      layoutCommands.addReviewTab();
    },
    [layoutCommands, workspaceId],
  );

  const clearSelection = useCallback(() => {
    setSelectedPaths([]);
    setLastSelectedPath(null);
  }, []);

  // ---------------------------------------------------------------------------
  // SCM actions — optimistic → await IPC → catch+reconcile / finally clearPending
  // ---------------------------------------------------------------------------

  const onStage = useCallback(
    async (entry: ScmEntry) => {
      const paths = selectedUnstagedPaths.includes(entry.path)
        ? selectedUnstagedPaths
        : [entry.path];
      applyOptimistic((current) => optimisticallyStageEntries(current, paths));
      addInflightPaths(paths);
      try {
        await gitStage(workspaceId, paths);
      } catch (error) {
        setLoadError(String(error));
        await reconcileScmAfterFailedAction();
      } finally {
        removeInflightPaths(paths);
      }
    },
    [
      workspaceId,
      selectedUnstagedPaths,
      applyOptimistic,
      addInflightPaths,
      removeInflightPaths,
      reconcileScmAfterFailedAction,
    ],
  );

  const onUnstage = useCallback(
    async (path: string) => {
      const paths = selectedStagedPaths.includes(path) ? selectedStagedPaths : [path];
      applyOptimistic((current) => optimisticallyUnstageEntries(current, paths));
      addInflightPaths(paths);
      try {
        await gitUnstage(workspaceId, paths);
      } catch (error) {
        setLoadError(String(error));
        await reconcileScmAfterFailedAction();
      } finally {
        removeInflightPaths(paths);
      }
    },
    [
      workspaceId,
      selectedStagedPaths,
      applyOptimistic,
      addInflightPaths,
      removeInflightPaths,
      reconcileScmAfterFailedAction,
    ],
  );

  const onStageAll = useCallback(async () => {
    if (!unstagedList.length) return;
    clearSelection();
    const paths = unstagedList.map((e) => e.path);
    applyOptimistic(optimisticallyStageAllEntries);
    addInflightPaths(paths);
    try {
      await gitStageAll(workspaceId);
    } catch (error) {
      setLoadError(String(error));
      await reconcileScmAfterFailedAction();
    } finally {
      removeInflightPaths(paths);
    }
  }, [
    workspaceId,
    unstagedList,
    clearSelection,
    applyOptimistic,
    addInflightPaths,
    removeInflightPaths,
    reconcileScmAfterFailedAction,
  ]);

  const onUnstageAll = useCallback(async () => {
    if (!stagedList.length) return;
    clearSelection();
    const paths = stagedList.map((e) => e.path);
    applyOptimistic(optimisticallyUnstageAllEntries);
    addInflightPaths(paths);
    try {
      await gitUnstageAll(workspaceId);
    } catch (error) {
      setLoadError(String(error));
      await reconcileScmAfterFailedAction();
    } finally {
      removeInflightPaths(paths);
    }
  }, [
    workspaceId,
    stagedList,
    clearSelection,
    applyOptimistic,
    addInflightPaths,
    removeInflightPaths,
    reconcileScmAfterFailedAction,
  ]);

  const onDiscard = useCallback(
    async (entry: ScmEntry) => {
      if (entry.untracked) {
        if (!window.confirm(`Permanently delete untracked "${entry.path}"?`)) return;
        try {
          await gitDiscardUntracked(workspaceId, [entry.path]);
        } catch (e) {
          setLoadError(String(e));
        }
        return;
      }
      if (
        !window.confirm(`Discard local changes to "${entry.path}"? Staged changes are not removed.`)
      )
        return;
      try {
        await gitDiscardTracked(workspaceId, [entry.path]);
      } catch (e) {
        setLoadError(String(e));
      }
    },
    [workspaceId],
  );

  const onDiscardAll = useCallback(async () => {
    if (!unstagedList.length) return;
    const entriesToDiscard = unstagedList;
    if (!window.confirm(`Discard ${entriesToDiscard.length} unstaged files?`)) return;
    clearSelection();
    try {
      const tracked = entriesToDiscard.filter((e) => !e.untracked).map((e) => e.path);
      const untracked = entriesToDiscard.filter((e) => e.untracked).map((e) => e.path);
      await Promise.all([
        tracked.length ? gitDiscardTracked(workspaceId, tracked) : Promise.resolve(),
        untracked.length ? gitDiscardUntracked(workspaceId, untracked) : Promise.resolve(),
      ]);
    } catch (e) {
      setLoadError(String(e));
    }
  }, [workspaceId, unstagedList, clearSelection]);

  const onCommit = useCallback(async () => {
    if (!canCommit) return;
    setBusy(true);
    try {
      await gitCommit(workspaceId, commitMessage);
      setCommitMessage("");
      // busy clears via useEffect once the backend snapshot confirms staged list is empty
    } catch (error) {
      setLoadError(String(error));
      setBusy(false);
    }
  }, [workspaceId, commitMessage, canCommit]);

  // ---------------------------------------------------------------------------
  // Git lifecycle / network actions (no optimistic state)
  // ---------------------------------------------------------------------------

  const handleRefresh = useCallback(async () => {
    try {
      await gitRefresh(workspaceId);
    } catch (error) {
      setLoadError(String(error));
    }
  }, [workspaceId]);

  const handleGitPush = useCallback(async () => {
    try {
      await gitPush(workspaceId);
    } catch (error) {
      setLoadError(String(error));
    }
  }, [workspaceId]);

  const handleGitFetch = useCallback(async () => {
    try {
      await gitFetch(workspaceId);
    } catch (error) {
      setLoadError(String(error));
    }
  }, [workspaceId]);

  const handleGitPull = useCallback(async () => {
    try {
      await gitPull(workspaceId);
    } catch (error) {
      setLoadError(String(error));
    }
  }, [workspaceId]);

  const handleOpenPr = useCallback(async () => {
    setPrError(null);
    setPrSending(true);
    try {
      const ctx = await gatherPrContext(workspaceId, activeTargetBranch ?? undefined);
      const hasUncommittedChanges = entries.length > 0;
      if (!ctx.hasCommits && !hasUncommittedChanges) {
        setPrError(`No commits or changes ahead of ${ctx.baseBranch}.`);
        setPrSending(false);
        return;
      }
      const wsScope = useTerminalScopeStore.getState().byScopeId[workspaceId] ?? null;
      const wsLayout = useLayoutStore.getState().byWorkspaceId[workspaceId] ?? null;
      const projScope = projectTerminalId
        ? (useTerminalScopeStore.getState().byScopeId[projectTerminalId] ?? null)
        : null;
      const projLayout = projectTerminalId
        ? (useLayoutStore.getState().byWorkspaceId[projectTerminalId] ?? null)
        : null;
      const target = findAgentTerminal(
        { scopeId: workspaceId, scope: wsScope, layout: wsLayout },
        projectTerminalId
          ? { scopeId: projectTerminalId, scope: projScope, layout: projLayout }
          : null,
      );
      if (!target) {
        setPrError("No coding agent detected. Start an agent in a terminal, then try again.");
        setPrSending(false);
        return;
      }
      const instruction = composePrInstruction(ctx, hasUncommittedChanges);
      await terminalCommands.sendInput(target.scopeId, target.sessionId, `${instruction}\n`);
      workspaceCommands.setPrAwaiting(workspaceId, true);
      if (wsLayout?.root) {
        const leaves = getAllLeaves(wsLayout.root);
        for (const leaf of leaves) {
          const tabIdx = leaf.tabs.findIndex(
            (tab) => tab.kind === "terminal" && tab.slotId === target.slotId,
          );
          if (tabIdx >= 0) {
            layoutCommands.setFocusedPane(leaf.id);
            break;
          }
        }
      }
    } catch (error) {
      setPrError(String(error));
    } finally {
      setPrSending(false);
    }
  }, [
    entries.length,
    activeTargetBranch,
    layoutCommands,
    projectTerminalId,
    terminalCommands,
    workspaceCommands,
    workspaceId,
  ]);

  useEffect(() => {
    const textarea = commitInputRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const lineHeight = 20;
    const maxHeight = lineHeight * 5;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [commitMessage]);

  // The shell always renders. Only the list body shows a loading indicator.
  return (
    <div className="flex h-full min-h-0 min-w-0 select-none flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-0 border-b border-[var(--theme-border)] px-2">
        <button
          type="button"
          className={`px-2 py-1.5 text-[11px] font-medium ${
            gitTab === "changes"
              ? "border-b-2 border-[var(--theme-interactive)] text-[var(--theme-text)]"
              : "text-[var(--theme-text-faint)] hover:text-[var(--theme-text-subtle)]"
          }`}
          onClick={() => setGitTab("changes")}
        >
          Changes
        </button>
        <button
          type="button"
          className={`px-2 py-1.5 text-[11px] font-medium ${
            gitTab === "checks"
              ? "border-b-2 border-[var(--theme-interactive)] text-[var(--theme-text)]"
              : "text-[var(--theme-text-faint)] hover:text-[var(--theme-text-subtle)]"
          }`}
          onClick={() => setGitTab("checks")}
        >
          Checks
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--theme-border)] px-2 py-1">
        <span className="text-[11px] text-[var(--theme-text-faint)]">Base:</span>
        <DropdownMenu open={branchPickerOpen} onOpenChange={handleBranchPickerOpenChange}>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="max-w-full gap-1 rounded-sm px-1.5 py-0.5 font-normal text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
              />
            }
            title="Select target branch"
            aria-label="Select target branch"
          >
            <span className="truncate font-mono text-[11px]">
              {formatTargetBranch(activeTargetBranch)}
            </span>
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={1.8} className="size-3 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64 min-w-64 p-0">
            <div className="border-b border-[var(--theme-border)] p-1">
              <Input
                value={branchSearch}
                autoFocus
                placeholder="Search branches"
                onChange={(event) => setBranchSearch(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                className="h-7 border-[var(--theme-border)] bg-[var(--theme-panel)]"
              />
            </div>
            <div
              className="max-h-72 overflow-y-auto overscroll-contain p-1"
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {branchContextLoading ? (
                <div className="px-2 py-2 text-xs text-[var(--theme-text-faint)]">
                  Loading branches
                </div>
              ) : filteredBranchOptions.length > 0 ? (
                filteredBranchOptions.map((branch) => (
                  <DropdownMenuItem
                    key={branch}
                    onClick={() => handleSelectTargetBranch(branch)}
                    className={`cursor-pointer font-mono text-[11px] hover:bg-accent hover:text-accent-foreground${
                      branch === activeTargetBranch
                        ? " bg-[var(--theme-panel-hover)] text-[var(--theme-text)]"
                        : ""
                    }`}
                  >
                    {branch}
                  </DropdownMenuItem>
                ))
              ) : (
                <div className="px-2 py-2 text-xs text-[var(--theme-text-faint)]">
                  No matching branches
                </div>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1.5">
        <span className="truncate text-xs font-medium text-[var(--theme-text-subtle)]">
          {workspaceLabel}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 text-[11px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            disabled={entries.length === 0}
            title="Review all changes"
            onClick={onOpenReview}
          >
            <HugeiconsIcon icon={GitCompareIcon} strokeWidth={1.5} className="size-3.5" />
            Review
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            disabled={!canCommit}
            title="Commit"
            onClick={onCommit}
          >
            <HugeiconsIcon icon={FilePlusIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            title="Refresh"
            onClick={handleRefresh}
          >
            <HugeiconsIcon icon={Refresh01Icon} strokeWidth={1.5} className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="shrink-0 px-2 py-1.5">
        <textarea
          ref={commitInputRef}
          className="min-h-0 w-full resize-none rounded border border-[var(--theme-border)] bg-[var(--theme-panel-elevated)] px-2 py-1 text-[12px] text-[var(--theme-text)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-interactive)] focus:outline-none"
          placeholder="Commit message"
          rows={1}
          value={commitMessage}
          disabled={busy}
          onChange={(event) => setCommitMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit) {
              event.preventDefault();
              onCommit();
            }
          }}
        />
        <div className="mt-1.5">
          <CommitDropdown
            onCommit={onCommit}
            canCommit={canCommit}
            busy={busy}
            scopeId={workspaceId}
            onPush={handleGitPush}
            onFetch={handleGitFetch}
            onPull={handleGitPull}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 w-full gap-1.5 text-[12px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          disabled={prSending || busy}
          onClick={handleOpenPr}
        >
          <GitPullRequest className="size-3.5" />
          Open Pull Request
        </Button>
      </div>

      {gitTab === "changes" && (
        <>
          {loadError && (
            <div className="shrink-0 border-b border-red-900/40 bg-red-950/25 px-2 py-1.5 text-[11px] text-red-300/90">
              {loadError}
            </div>
          )}

          <div
            data-scm-sidebar="true"
            className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-none pb-1"
            style={{ overscrollBehavior: "none" }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                clearSelection();
              }
            }}
          >
            {snapshot === null && (
              <div className="flex items-center justify-center px-4 py-8">
                <DotGridLoader
                  variant="default"
                  gridSize={5}
                  sizeClassName="h-8 w-8"
                  className="opacity-90"
                />
              </div>
            )}
            {snapshot !== null && entries.length === 0 && (
              <div className="px-2 py-2 text-xs text-[var(--theme-text-subtle)]">No changes</div>
            )}

            <StagedChangesSection
              stagedList={stagedList}
              stagedOpen={stagedOpen}
              setStagedOpen={setStagedOpen}
              pendingPaths={inflightPaths}
              stickyTop={0}
              stickyZIndex={GIT_SECTION_STICKY_Z_INDEX_BASE}
              selectedPaths={selectedPathSet}
              visiblePaths={stagedVisiblePaths}
              onOpenFile={(path) =>
                openFile(workspaceId, workspaceRoot, path).catch((err) =>
                  console.error("Failed to open file:", err),
                )
              }
              onOpenReviewPath={(path) => onOpenReviewPath(path, "staged")}
              onSelectEntry={selectEntry}
              onUnstage={onUnstage}
              onUnstageAll={onUnstageAll}
            />

            <UnstagedChangesSection
              unstagedList={unstagedList}
              changesOpen={changesOpen}
              setChangesOpen={setChangesOpen}
              pendingPaths={inflightPaths}
              stickyTop={0}
              stickyZIndex={GIT_SECTION_STICKY_Z_INDEX_BASE}
              selectedPaths={selectedPathSet}
              visiblePaths={unstagedVisiblePaths}
              onOpenFile={(path) =>
                openFile(workspaceId, workspaceRoot, path).catch((err) =>
                  console.error("Failed to open file:", err),
                )
              }
              onOpenReviewPath={(path) => onOpenReviewPath(path, "working")}
              onSelectEntry={selectEntry}
              onDiscard={onDiscard}
              onStage={onStage}
              onDiscardAll={onDiscardAll}
              onStageAll={onStageAll}
            />
          </div>

          {prError && (
            <div className="mx-2 mb-1 rounded border border-red-900/40 bg-red-950/25 px-2 py-1 text-[11px] text-red-300/90">
              {prError}
            </div>
          )}
        </>
      )}

      {gitTab === "checks" && (
        <div className="min-h-0 flex-1 overflow-auto">
          <ChecksPanel worktreePath={workspaceRoot} />
        </div>
      )}
    </div>
  );
}
