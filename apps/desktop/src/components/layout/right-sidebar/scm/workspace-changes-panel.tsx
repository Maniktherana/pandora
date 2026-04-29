import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useTerminalScopeStore } from "@/services/terminal/terminal-scope-store";
import { useLayoutStore } from "@/services/workspace/layout-store";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useGitController } from "@/services/git/use-git";
import type { GitSelectionModifiers } from "@/services/git/git-types";
import type { ScmEntry } from "@/lib/shared/types";
import {
  composePrInstruction,
  findAgentTerminal,
  gatherPrContext,
} from "@/components/layout/right-sidebar/scm/pr.utils";
import { projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { getAllLeaves } from "@/components/layout/workspace/layout-tree";
import { StagedChangesSection } from "./staged-changes-section";
import { UnstagedChangesSection } from "./unstaged-changes-section";
import { CommitDropdown } from "./commit-dropdown";
import { ChecksPanel } from "./checks-panel";
import { GIT_SECTION_STICKY_Z_INDEX_BASE } from "@/services/git/git-types";
import DotGridLoader from "@/components/dot-grid-loader";
import type { DiffSource } from "@/lib/shared/types";
import { requestReviewNavigation } from "@/services/editor/review-navigation-store";
import { formatTargetBranch, resolveWorkspaceTargetBranch } from "./target-branch";

type WorkspaceChangesPanelProps = {
  workspaceRoot: string;
  workspaceId: string;
  workspaceLabel: string;
};

function hasStaged(entry: ScmEntry): boolean {
  return entry.stagedKind != null && entry.stagedKind !== "";
}

function hasUnstaged(entry: ScmEntry): boolean {
  return entry.untracked || (entry.worktreeKind != null && entry.worktreeKind !== "");
}

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
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);

  const scm = useGitController(workspaceId);
  const { openFile } = useEditorActions();
  const layoutCommands = useLayoutActions();
  const terminalCommands = useTerminalActions();
  const workspaceCommands = useWorkspaceActions();
  const workspace = useWorkspaceView(workspaceId, (view) => view.workspace);
  const projectRuntimeId = workspace ? projectRuntimeKey(workspace.projectId) : null;

  // Read pre-derived lists directly from the store — no filter/sort in render.
  const stagedList = scm.stagedEntries;
  const unstagedList = scm.unstagedEntries;
  const pendingPaths = scm.pendingPaths;

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
    if (scm.snapshot?.targetBranch !== undefined) {
      setTargetBranch((current) => current ?? scm.snapshot?.targetBranch ?? null);
    }
  }, [scm.snapshot?.targetBranch]);

  // Reset per-workspace UI state on workspace switch.
  useEffect(() => {
    setSelectedPaths([]);
    setLastSelectedPath(null);
  }, [workspaceId]);

  // Drop selected paths that no longer exist in the server list.
  useEffect(() => {
    if (!scm.entries.length) return;
    const existingPaths = new Set(scm.entries.map((entry) => entry.path));
    setSelectedPaths((current) => current.filter((path) => existingPaths.has(path)));
    setLastSelectedPath((current) => (current && existingPaths.has(current) ? current : null));
  }, [scm.entries]);

  // Clear busy when snapshot confirms a commit completed (staged list goes empty).
  useEffect(() => {
    if (busy && scm.snapshot && stagedList.length === 0) {
      setBusy(false);
    }
  }, [busy, scm.snapshot, stagedList.length]);

  useEffect(() => {
    if (!branchPickerOpen) setBranchSearch("");
  }, [branchPickerOpen]);

  useEffect(() => {
    if (!scm.branchContext) return;
    setTargetBranch((current) =>
      resolveWorkspaceTargetBranch(
        scm.branchContext!,
        current ?? scm.snapshot?.targetBranch ?? null,
      ),
    );
  }, [scm.branchContext, scm.snapshot?.targetBranch]);

  const branchOptions = useMemo(() => {
    const currentBranch = scm.branchContext?.currentBranch ?? "";
    const options = Array.from(new Set(scm.branchContext?.availableBranches ?? []));
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
  }, [scm.branchContext?.availableBranches, scm.branchContext?.currentBranch]);

  const filteredBranchOptions = useMemo(() => {
    const query = branchSearch.trim().toLowerCase();
    if (!query) return branchOptions;
    return branchOptions.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchOptions, branchSearch]);

  const activeTargetBranch = targetBranch ?? scm.branchContext?.defaultTargetBranch ?? null;

  const handleBranchPickerOpenChange = useCallback(
    (open: boolean) => {
      setBranchPickerOpen(open);
      if (open) scm.loadBranchContext();
    },
    [scm],
  );

  const handleSelectTargetBranch = useCallback(
    (branch: string) => {
      setTargetBranch(branch);
      scm.setTargetBranch(branch);
      setBranchPickerOpen(false);
      setBranchSearch("");
    },
    [scm],
  );

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

  const onDiscard = (entry: ScmEntry) => {
    if (entry.untracked) {
      if (!window.confirm(`Permanently delete untracked "${entry.path}"?`)) return;
      try { scm.discardUntracked([entry.path]); } catch (e) { setLoadError(String(e)); }
      return;
    }
    if (
      !window.confirm(`Discard local changes to "${entry.path}"? Staged changes are not removed.`)
    )
      return;
    try { scm.discardTracked([entry.path]); } catch (e) { setLoadError(String(e)); }
  };

  const onUnstage = (path: string) => {
    const paths = selectedStagedPaths.includes(path) ? selectedStagedPaths : [path];
    try { scm.unstage(paths); } catch (e) { setLoadError(String(e)); }
  };

  const onCommit = () => {
    setBusy(true);
    try {
      scm.commit(commitMessage);
      setCommitMessage("");
    } catch (error) {
      setLoadError(String(error));
      setBusy(false);
    }
  };

  const onUnstageAll = () => {
    if (!stagedList.length) return;
    clearSelection();
    try { scm.unstageAll(); } catch (e) { setLoadError(String(e)); }
  };

  const onStageAll = () => {
    if (!unstagedList.length) return;
    clearSelection();
    try { scm.stageAll(); } catch (e) { setLoadError(String(e)); }
  };

  const onDiscardAll = () => {
    if (!unstagedList.length) return;
    const entriesToDiscard = unstagedList;
    if (!window.confirm(`Discard ${entriesToDiscard.length} unstaged files?`)) return;
    clearSelection();
    try {
      const tracked = entriesToDiscard.filter((e) => !e.untracked).map((e) => e.path);
      const untracked = entriesToDiscard.filter((e) => e.untracked).map((e) => e.path);
      if (tracked.length) scm.discardTracked(tracked);
      if (untracked.length) scm.discardUntracked(untracked);
    } catch (e) { setLoadError(String(e)); }
  };

  const onStage = (entry: ScmEntry) => {
    const paths = selectedUnstagedPaths.includes(entry.path) ? selectedUnstagedPaths : [entry.path];
    try { scm.stage(paths); } catch (e) { setLoadError(String(e)); }
  };

  const handleOpenPr = useCallback(async () => {
    setPrError(null);
    setPrSending(true);
    try {
      const ctx = await gatherPrContext(workspaceId, activeTargetBranch ?? undefined);
      const hasUncommittedChanges = scm.entries.length > 0;
      if (!ctx.hasCommits && !hasUncommittedChanges) {
        setPrError(`No commits or changes ahead of ${ctx.baseBranch}.`);
        setPrSending(false);
        return;
      }
      const wsScope = useTerminalScopeStore.getState().byScopeId[workspaceId] ?? null;
      const wsLayout = useLayoutStore.getState().byWorkspaceId[workspaceId] ?? null;
      const projScope = projectRuntimeId
        ? (useTerminalScopeStore.getState().byScopeId[projectRuntimeId] ?? null)
        : null;
      const projLayout = projectRuntimeId
        ? (useLayoutStore.getState().byWorkspaceId[projectRuntimeId] ?? null)
        : null;
      const target = findAgentTerminal(
        { scopeId: workspaceId, scope: wsScope, layout: wsLayout },
        projectRuntimeId
          ? { scopeId: projectRuntimeId, scope: projScope, layout: projLayout }
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
    scm.entries.length,
    activeTargetBranch,
    layoutCommands,
    projectRuntimeId,
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
              {scm.branchContextLoading ? (
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
            disabled={scm.entries.length === 0}
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
            onClick={() => scm.refresh()}
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
            scm={scm}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 w-full gap-1.5 text-[12px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          disabled={prSending || busy}
          onClick={() => handleOpenPr().catch((err) => setPrError(String(err)))}
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
            {scm.snapshot === null && (
              <div className="flex items-center justify-center px-4 py-8">
                <DotGridLoader
                  variant="default"
                  gridSize={5}
                  sizeClassName="h-8 w-8"
                  className="opacity-90"
                />
              </div>
            )}
            {scm.snapshot !== null && scm.entries.length === 0 && (
              <div className="px-2 py-2 text-xs text-[var(--theme-text-subtle)]">No changes</div>
            )}

            <StagedChangesSection
              stagedList={stagedList}
              stagedOpen={stagedOpen}
              setStagedOpen={setStagedOpen}
              pendingPaths={pendingPaths}
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
              pendingPaths={pendingPaths}
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
