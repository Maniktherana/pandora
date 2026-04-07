import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { useProjectTerminalView, useWorkspaceView } from "@/hooks/use-desktop-view";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import type { DiffSource } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import {
  scmCommit,
  scmDiscardTracked,
  scmDiscardUntracked,
  scmStageAll,
  scmStatus,
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
import { ChangesFooter } from "./changes-footer";
import { StagedChangesSection } from "./staged-changes-section";
import { UnstagedChangesSection } from "./unstaged-changes-section";
import { SCM_CHANGES_REFRESH_INTERVAL_MS } from "./scm.types";

type WorkspaceChangesPanelProps = {
  workspaceRoot: string;
  workspaceId: string;
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
}: WorkspaceChangesPanelProps) {
  const [entries, setEntries] = useState<ScmStatusEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [prError, setPrError] = useState<string | null>(null);
  const [prSending, setPrSending] = useState(false);

  const { openFile } = useEditorActions();
  const layoutCommands = useLayoutActions();
  const terminalCommands = useTerminalActions();
  const workspaceCommands = useWorkspaceActions();
  const workspace = useWorkspaceView(workspaceId, (view) => view.workspace);
  const workspaceRuntime = useWorkspaceView(workspaceId, (view) => view.runtime);
  const projectRuntimeId = workspace ? projectRuntimeKey(workspace.projectId) : null;
  const projectRuntime = useProjectTerminalView(projectRuntimeId ?? "", (view) => view.runtime);

  const refresh = useCallback(() => {
    void scmStatus(workspaceRoot)
      .then((list) => {
        setEntries(list);
        setLoadError(null);
      })
      .catch((error) => {
        setLoadError(String(error));
        setEntries([]);
      });
  }, [workspaceRoot]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const intervalID = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, SCM_CHANGES_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalID);
  }, [refresh]);

  const stagedList = useMemo(() => (entries ?? []).filter(hasStaged), [entries]);
  const unstagedList = useMemo(() => (entries ?? []).filter(hasUnstaged), [entries]);
  const canCommit = stagedList.length > 0 && commitMessage.trim().length > 0 && !busy;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (error) {
      setLoadError(String(error));
    } finally {
      setBusy(false);
    }
  };

  const onOpenDiff = (path: string, source: DiffSource) => {
    layoutCommands.addDiffTabForPath(path, source);
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

  const handleOpenPr = useCallback(async () => {
    setPrError(null);
    setPrSending(true);
    try {
      const ctx = await gatherPrContext(workspaceId);

      if (ctx.isDefaultBranch) {
        if (
          !window.confirm(
            `You're on ${ctx.baseBranch}. PRs are usually from feature branches. Continue anyway?`,
          )
        ) {
          setPrSending(false);
          return;
        }
      }

      const hasUncommittedChanges = (entries ?? []).length > 0;
      if (!ctx.hasCommits && !hasUncommittedChanges) {
        setPrError(`No commits or changes ahead of ${ctx.baseBranch}.`);
        setPrSending(false);
        return;
      }

      const target = findAgentTerminal(workspaceRuntime, projectRuntime);
      if (!target) {
        setPrError(
          "No coding agent detected. Start an agent (claude, codex, etc.) in a terminal, then try again.",
        );
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

  const handleArchive = useCallback(async () => {
    if (!window.confirm("Archive this workspace? The worktree will be removed.")) return;
    try {
      await archiveWorkspaceCmd(workspaceId);
      workspaceCommands.archiveWorkspace(workspaceId);
    } catch (error) {
      setPrError(String(error));
    }
  }, [workspaceCommands, workspaceId]);

  useEffect(() => {
    const handler = () => void handleOpenPr();
    window.addEventListener("pandora:open-pr", handler);
    return () => window.removeEventListener("pandora:open-pr", handler);
  }, [handleOpenPr]);

  return (
    <div className="flex h-full min-h-0 select-none flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--theme-border)] px-1.5 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          disabled={busy}
          title="Refresh"
          onClick={() => refresh()}
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          disabled={busy || !unstagedList.length}
          title="Stage all"
          onClick={() => void run(() => scmStageAll(workspaceRoot))}
        >
          Stage all
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
          disabled={busy || !stagedList.length}
          title="Unstage all"
          onClick={() => {
            if (stagedList.length > 5) {
              if (!window.confirm(`Unstage all ${stagedList.length} files?`)) return;
            }
            void run(() => scmUnstageAll(workspaceRoot));
          }}
        >
          Unstage all
        </Button>
      </div>

      {loadError && (
        <div className="shrink-0 border-b border-red-900/40 bg-red-950/25 px-2 py-1.5 text-[11px] text-red-300/90">
          {loadError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto py-1">
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
            workspaceRoot={workspaceRoot}
            onOpenDiff={onOpenDiff}
            onOpenFile={(path) => void openFile(workspaceId, workspaceRoot, path)}
            run={(fn) => void run(fn)}
          />
        ) : null}

        {entries ? (
          <UnstagedChangesSection
            unstagedList={unstagedList}
            changesOpen={changesOpen}
            setChangesOpen={setChangesOpen}
            busy={busy}
            workspaceRoot={workspaceRoot}
            onOpenDiff={onOpenDiff}
            onOpenFile={(path) => void openFile(workspaceId, workspaceRoot, path)}
            onDiscard={onDiscard}
            run={(fn) => void run(fn)}
          />
        ) : null}
      </div>

      <ChangesFooter
        workspace={workspace}
        busy={busy}
        canCommit={canCommit}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        prSending={prSending}
        prError={prError}
        onCommit={() =>
          void run(async () => {
            await scmCommit(workspaceRoot, commitMessage);
            setCommitMessage("");
          })
        }
        onOpenPr={() => void handleOpenPr()}
        onArchive={() => void handleArchive()}
        onOpenPrUrl={(url) => void open(url)}
      />
    </div>
  );
}
