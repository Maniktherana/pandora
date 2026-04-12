import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FilePlusIcon, GitCompareIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { GitPullRequest } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { useRuntimeState, useWorkspaceView } from "@/hooks/use-desktop-view";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import {
  scmCommit,
  scmDiscardTracked,
  scmDiscardUntracked,
  scmStageAll,
  scmUnstage,
  scmUnstageAll,
} from "@/components/layout/right-sidebar/scm/scm.utils";
import type { ScmStatusEntry } from "./scm.types";
import {
  archiveWorkspace as archiveWorkspaceCmd,
  composePrInstruction,
  findAgentTerminal,
  gatherPrContext,
} from "@/components/layout/right-sidebar/scm/pr.utils";
import { projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { getAllLeaves } from "@/components/layout/workspace/layout-tree";
import { StagedChangesSection } from "./staged-changes-section";
import { UnstagedChangesSection } from "./unstaged-changes-section";
import { useScmStatusQuery } from "./scm-queries";
import {
  SCM_SECTION_STICKY_Z_INDEX_BASE,
} from "./scm.types";
import DotGridLoader from "@/components/dot-grid-loader";

type WorkspaceChangesPanelProps = {
  workspaceRoot: string;
  workspaceId: string;
  workspaceLabel: string;
};

function hasStaged(entry: ScmStatusEntry): boolean {
  return entry.stagedKind != null && entry.stagedKind !== "";
}

function hasUnstaged(entry: ScmStatusEntry): boolean {
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
  const commitInputRef = useRef<HTMLTextAreaElement | null>(null);

  const { openFile } = useEditorActions();
  const layoutCommands = useLayoutActions();
  const terminalCommands = useTerminalActions();
  const workspaceCommands = useWorkspaceActions();
  const workspace = useWorkspaceView(workspaceId, (view) => view.workspace);
  const workspaceRuntime = useRuntimeState(workspaceId);
  const projectRuntimeId = workspace ? projectRuntimeKey(workspace.projectId) : null;
  const projectRuntime = useRuntimeState(projectRuntimeId ?? "");
  const {
    data: entriesData,
    error: entriesError,
    refetch: refetchEntries,
  } = useScmStatusQuery(workspaceRoot);
  const entries = entriesData ?? null;

  useEffect(() => {
    if (entriesError) {
      setLoadError(String(entriesError));
      return;
    }
    setLoadError(null);
  }, [entriesError]);

  const stagedList = useMemo(() => (entries ?? []).filter(hasStaged), [entries]);
  const unstagedList = useMemo(() => (entries ?? []).filter(hasUnstaged), [entries]);
  const canCommit = stagedList.length > 0 && commitMessage.trim().length > 0 && !busy;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await refetchEntries();
    } catch (error) {
      setLoadError(String(error));
    } finally {
      setBusy(false);
    }
  };

  const onOpenReview = () => {
    layoutCommands.addReviewTab();
  };

  const onDiscard = (entry: ScmStatusEntry) => {
    if (entry.untracked) {
      if (!window.confirm(`Permanently delete untracked "${entry.path}"?`)) return;
      void run(() => scmDiscardUntracked(workspaceRoot, entry.path));
      return;
    }
    if (
      !window.confirm(`Discard local changes to "${entry.path}"? Staged changes are not removed.`)
    )
      return;
    void run(() => scmDiscardTracked(workspaceRoot, entry.path));
  };

  const onUnstage = (path: string) => {
    void run(() => scmUnstage(workspaceRoot, [path]));
  };

  const onCommit = () =>
    void run(async () => {
      await scmCommit(workspaceRoot, commitMessage);
      setCommitMessage("");
    });

  const onUnstageAll = () => {
    if (!stagedList.length) return;
    void run(() => scmUnstageAll(workspaceRoot));
  };

  const onStageAll = () => {
    if (!unstagedList.length) return;
    void run(() => scmStageAll(workspaceRoot));
  };

  const onDiscardAll = () => {
    if (!unstagedList.length) return;
    if (!window.confirm(`Discard all ${unstagedList.length} unstaged files?`)) return;
    void run(async () => {
      for (const entry of unstagedList) {
        if (entry.untracked) await scmDiscardUntracked(workspaceRoot, entry.path);
        else await scmDiscardTracked(workspaceRoot, entry.path);
      }
    });
  };

  const handleOpenPr = useCallback(async () => {
    setPrError(null);
    setPrSending(true);
    try {
      const ctx = await gatherPrContext(workspaceId);
      const hasUncommittedChanges = (entries ?? []).length > 0;
      if (!ctx.hasCommits && !hasUncommittedChanges) {
        setPrError(`No commits or changes ahead of ${ctx.baseBranch}.`);
        setPrSending(false);
        return;
      }
      const target = findAgentTerminal(workspaceRuntime, projectRuntime);
      if (!target) {
        setPrError("No coding agent detected. Start an agent in a terminal, then try again.");
        setPrSending(false);
        return;
      }
      const instruction = composePrInstruction(ctx, hasUncommittedChanges);
      await terminalCommands.sendInput(target.runtimeId, target.sessionId, `${instruction}\n`);
      workspaceCommands.setPrAwaiting(workspaceId, true);
      if (workspaceRuntime?.root) {
        const leaves = getAllLeaves(workspaceRuntime.root);
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
    entries,
    layoutCommands,
    projectRuntime,
    terminalCommands,
    workspaceCommands,
    workspaceId,
    workspaceRuntime,
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

  if (entries === null && !loadError) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4">
        <div className="flex flex-col items-center text-center text-[var(--theme-text-faint)]">
          <DotGridLoader variant="default" gridSize={5} sizeClassName="h-8 w-8" className="opacity-90" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 select-none flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 py-1.5">
        <span className="truncate text-xs font-medium text-[var(--theme-text-subtle)]">{workspaceLabel}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 px-2 text-[11px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            disabled={!entries || entries.length === 0}
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
            onClick={() =>
              void run(async () => {
                await scmCommit(workspaceRoot, commitMessage);
                setCommitMessage("");
              })
            }
          >
            <HugeiconsIcon icon={FilePlusIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            disabled={busy}
            title="Refresh"
            onClick={() => void refetchEntries()}
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
        <Button
          type="button"
          size="sm"
          className="mt-1.5 h-8 w-full text-[12px]"
          disabled={!canCommit}
          onClick={onCommit}
        >
          Commit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 w-full gap-1.5 text-[12px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          disabled={prSending || busy}
          onClick={() => void handleOpenPr()}
        >
          <GitPullRequest className="size-3.5" />
          Open Pull Request
        </Button>
      </div>

      {loadError && (
        <div className="shrink-0 border-b border-red-900/40 bg-red-950/25 px-2 py-1.5 text-[11px] text-red-300/90">
          {loadError}
        </div>
      )}

      <div
        data-scm-sidebar="true"
        className="relative min-h-0 flex-1 overflow-auto overscroll-none pb-1"
        style={{ overscrollBehavior: "none" }}
      >
        {entries === null && (
          <div className="px-2 py-2 text-xs text-[var(--theme-text-subtle)]">Loading changes…</div>
        )}
        {entries && entries.length === 0 && (
          <div className="px-2 py-2 text-xs text-[var(--theme-text-subtle)]">No changes</div>
        )}

        {entries ? (
          <StagedChangesSection
            stagedList={stagedList}
            stagedOpen={stagedOpen}
            setStagedOpen={setStagedOpen}
            busy={busy}
            stickyTop={0}
            stickyZIndex={SCM_SECTION_STICKY_Z_INDEX_BASE}
            onOpenFile={(path) => void openFile(workspaceId, workspaceRoot, path)}
            onUnstage={onUnstage}
            onUnstageAll={onUnstageAll}
          />
        ) : null}

        {entries ? (
          <UnstagedChangesSection
            unstagedList={unstagedList}
            changesOpen={changesOpen}
            setChangesOpen={setChangesOpen}
            busy={busy}
            stickyTop={0}
            stickyZIndex={SCM_SECTION_STICKY_Z_INDEX_BASE}
            workspaceRoot={workspaceRoot}
            onOpenFile={(path) => void openFile(workspaceId, workspaceRoot, path)}
            onDiscard={onDiscard}
            run={(fn) => void run(fn)}
            onDiscardAll={onDiscardAll}
            onStageAll={onStageAll}
          />
        ) : null}
      </div>
      {prError && (
        <div className="mx-2 mb-1 rounded border border-red-900/40 bg-red-950/25 px-2 py-1 text-[11px] text-red-300/90">
          {prError}
        </div>
      )}
    </div>
  );
}
