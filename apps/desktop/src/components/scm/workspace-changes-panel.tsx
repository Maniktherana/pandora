import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronRight,
  ExternalLink,
  FileText,
  GitMerge,
  GitPullRequest,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileTypeIcon } from "@/components/files/file-type-icon";
import {
  useAppView,
  useLayoutCommands,
  useProjectTerminalView,
  useWorkspaceCommands,
  useWorkspaceView,
} from "@/hooks/use-app-view";
import type { DiffSource } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import {
  scmCommit,
  scmDiscardTracked,
  scmDiscardUntracked,
  scmToneTextClass,
  scmStage,
  scmStageAll,
  scmStatus,
  statusTone,
  scmUnstage,
  scmUnstageAll,
  type ScmStatusEntry,
} from "@/lib/workspace/scm";
import {
  findAgentTerminal,
  composePrInstruction,
  gatherPrContext,
  archiveWorkspace as archiveWorkspaceCmd,
} from "@/lib/workspace/pr";
import { getTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
import { projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { useEditorStore } from "@/stores/editor-store";
import { findLeaf, getAllLeaves } from "@/lib/layout/layout-tree";

function hasStaged(e: ScmStatusEntry): boolean {
  return e.stagedKind != null && e.stagedKind !== "";
}

function hasUnstaged(e: ScmStatusEntry): boolean {
  return e.untracked || (e.worktreeKind != null && e.worktreeKind !== "");
}

function statusBadge(text: string, className?: string) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 font-mono text-[10px] font-medium text-[var(--oc-text-muted)]",
        className
      )}
    >
      {text}
    </span>
  );
}

function entryTone(entry: ScmStatusEntry) {
  return statusTone(entry);
}

export default function WorkspaceChangesPanel({
  workspaceRoot,
  workspaceId,
}: {
  workspaceRoot: string;
  workspaceId: string;
}) {
  const [entries, setEntries] = useState<ScmStatusEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);

  const openFile = useEditorStore((s) => s.openFile);
  const layoutCommands = useLayoutCommands();
  const workspaceCommands = useWorkspaceCommands();
  const workspace = useWorkspaceView(workspaceId, (view) => view.workspace);
  const workspaceRuntime = useWorkspaceView(workspaceId, (view) => view.runtime);
  const projectRuntimeId = workspace ? projectRuntimeKey(workspace.projectId) : null;
  const projectRuntime = useProjectTerminalView(
    projectRuntimeId ?? "",
    (view) => view.runtime
  );

  const [prError, setPrError] = useState<string | null>(null);
  const [prSending, setPrSending] = useState(false);

  const refresh = useCallback(() => {
    void scmStatus(workspaceRoot)
      .then((list) => {
        setEntries(list);
        setLoadError(null);
      })
      .catch((e) => {
        setLoadError(String(e));
        setEntries([]);
      });
  }, [workspaceRoot]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const stagedList = useMemo(() => (entries ?? []).filter(hasStaged), [entries]);
  const unstagedList = useMemo(() => (entries ?? []).filter(hasUnstaged), [entries]);

  const anyStaged = stagedList.length > 0;
  const canCommit = anyStaged && commitMessage.trim().length > 0 && !busy;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      refresh();
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onOpenDiff = (path: string, source: DiffSource) => {
    layoutCommands.addDiffTabForPath(path, source);
  };

  const onDiscard = (e: ScmStatusEntry) => {
    const label = e.path;
    if (e.untracked) {
      if (!window.confirm(`Permanently delete untracked “${label}”?`)) return;
      void run(() => scmDiscardUntracked(workspaceRoot, e.path));
      return;
    }
    if (!window.confirm(`Discard local changes to “${label}”? Staged changes are not removed.`)) return;
    void run(() => scmDiscardTracked(workspaceRoot, e.path));
  };

  const handleOpenPr = useCallback(async () => {
    setPrError(null);
    setPrSending(true);
    try {
      const ctx = await gatherPrContext(workspaceId);

      if (ctx.isDefaultBranch) {
        if (!window.confirm(`You're on ${ctx.baseBranch}. PRs are usually from feature branches. Continue anyway?`)) {
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
        setPrError("No coding agent detected. Start an agent (claude, codex, etc.) in a terminal, then try again.");
        setPrSending(false);
        return;
      }

      const instruction = composePrInstruction(ctx, hasUncommittedChanges);
      const client = getTerminalDaemonClient();
      if (!client) {
        setPrError("Terminal daemon not connected.");
        setPrSending(false);
        return;
      }

      // Paste the full instruction directly into the agent terminal
      const prompt = instruction;
      const bytes = new TextEncoder().encode(prompt + "\n");
      const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
      client.input(target.runtimeId, target.sessionId, btoa(binary));
      workspaceCommands.setPrAwaiting(workspaceId, true);

      // Focus the agent terminal pane
      if (workspaceRuntime?.root) {
        const leaves = getAllLeaves(workspaceRuntime.root);
        for (const leaf of leaves) {
          const tabIdx = leaf.tabs.findIndex(
            (t) => t.kind === "terminal" && t.slotId === target.slotId
          );
          if (tabIdx >= 0) {
            layoutCommands.setFocusedPane(leaf.id);
            break;
          }
        }
      }
    } catch (e) {
      setPrError(String(e));
    } finally {
      setPrSending(false);
    }
  }, [entries, layoutCommands, projectRuntime, workspaceCommands, workspaceId, workspaceRuntime]);

  const handleArchive = useCallback(async () => {
    if (!window.confirm("Archive this workspace? The worktree will be removed.")) return;
    try {
      await archiveWorkspaceCmd(workspaceId);
      workspaceCommands.archiveWorkspace(workspaceId);
    } catch (e) {
      setPrError(String(e));
    }
  }, [workspaceCommands, workspaceId]);

  // Listen for ⌘⇧P shortcut
  useEffect(() => {
    const handler = () => void handleOpenPr();
    window.addEventListener("pandora:open-pr", handler);
    return () => window.removeEventListener("pandora:open-pr", handler);
  }, [handleOpenPr]);

  return (
    <div className="flex h-full min-h-0 select-none flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-[var(--oc-border)] px-1.5 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-[var(--oc-text-muted)] hover:text-[var(--oc-text)]"
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
          className="h-7 px-2 text-[11px] text-[var(--oc-text-muted)] hover:text-[var(--oc-text)]"
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
          className="h-7 px-2 text-[11px] text-[var(--oc-text-muted)] hover:text-[var(--oc-text)]"
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
          <div className="px-2 py-2 text-xs text-[var(--oc-text-subtle)]">Loading changes…</div>
        )}
        {entries && entries.length === 0 && (
          <div className="px-2 py-2 text-xs text-[var(--oc-text-subtle)]">No changes</div>
        )}

        {entries && stagedList.length > 0 && (
          <Collapsible open={stagedOpen} onOpenChange={setStagedOpen}>
            <CollapsibleTrigger
              nativeButton={false}
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="group h-auto min-h-0 w-full justify-start gap-1 rounded-none py-1 pl-2 pr-1 font-normal text-[var(--oc-text-muted)] hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)] data-[panel-open]:bg-[var(--oc-panel-hover)]"
                >
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
                  <span className="text-[11px] font-medium uppercase tracking-wide">
                    Staged ({stagedList.length})
                  </span>
                </Button>
              }
            />
            <CollapsibleContent>
              <ul className="flex flex-col gap-0.5 pb-1">
                {stagedList.map((e) => (
                  <li
                    key={`s:${e.path}`}
                    className="flex min-w-0 items-center gap-0.5 border-b border-[var(--oc-border)]/60 py-0.5 pl-1 pr-1 last:border-b-0"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0 text-[var(--oc-text-muted)] hover:text-[var(--oc-text)]"
                      title="Open staged diff"
                      disabled={busy}
                      onClick={() => onOpenDiff(e.path, "staged")}
                    >
                      <FileTypeIcon path={e.path} kind="file" className="pointer-events-none" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1">
                        {e.stagedKind ? statusBadge(e.stagedKind, cn("bg-transparent", scmToneTextClass(entryTone(e)))) : null}
                        <button
                          type="button"
                          className={cn(
                            "min-w-0 truncate text-left font-mono text-[11px] hover:opacity-80 hover:underline",
                            scmToneTextClass(entryTone(e))
                          )}
                          title={e.path}
                          disabled={busy}
                          onClick={() => onOpenDiff(e.path, "staged")}
                        >
                          {e.path}
                        </button>
                      </div>
                      {e.origPath ? (
                        <div className="truncate pl-1 font-mono text-[10px] text-[var(--oc-text-faint)]" title={e.origPath}>
                          ← {e.origPath}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-[var(--oc-text-subtle)] hover:text-[var(--oc-text)]"
                        title="Open file"
                        disabled={busy}
                        onClick={() => void openFile(workspaceId, workspaceRoot, e.path)}
                      >
                        <FileText className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-[var(--oc-text-subtle)] hover:text-[var(--oc-text)]"
                        title="Unstage"
                        disabled={busy}
                        onClick={() => void run(() => scmUnstage(workspaceRoot, [e.path]))}
                      >
                        <Minus className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}

        {entries && unstagedList.length > 0 && (
          <Collapsible open={changesOpen} onOpenChange={setChangesOpen}>
            <CollapsibleTrigger
              nativeButton={false}
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="group h-auto min-h-0 w-full justify-start gap-1 rounded-none py-1 pl-2 pr-1 font-normal text-[var(--oc-text-muted)] hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)] data-[panel-open]:bg-[var(--oc-panel-hover)]"
                >
                  <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
                  <span className="text-[11px] font-medium uppercase tracking-wide">
                    Changes ({unstagedList.length})
                  </span>
                </Button>
              }
            />
            <CollapsibleContent>
              <ul className="flex flex-col gap-0.5 pb-1">
                {unstagedList.map((e) => (
                  <li
                    key={`u:${e.path}`}
                    className="flex min-w-0 items-center gap-0.5 border-b border-[var(--oc-border)]/60 py-0.5 pl-1 pr-1 last:border-b-0"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0 text-[var(--oc-text-muted)] hover:text-[var(--oc-text)]"
                      title="Open diff (working tree)"
                      disabled={busy}
                      onClick={() => onOpenDiff(e.path, "working")}
                    >
                      <FileTypeIcon path={e.path} kind="file" className="pointer-events-none" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1">
                        {e.untracked
                          ? statusBadge("?", cn("bg-transparent", scmToneTextClass("added")))
                          : e.worktreeKind
                            ? statusBadge(e.worktreeKind, cn("bg-transparent", scmToneTextClass(entryTone(e))))
                            : null}
                        <button
                          type="button"
                          className={cn(
                            "min-w-0 truncate text-left font-mono text-[11px] hover:opacity-80 hover:underline",
                            scmToneTextClass(entryTone(e))
                          )}
                          title={e.path}
                          disabled={busy}
                          onClick={() => onOpenDiff(e.path, "working")}
                        >
                          {e.path}
                        </button>
                      </div>
                      {e.origPath ? (
                        <div className="truncate pl-1 font-mono text-[10px] text-[var(--oc-text-faint)]" title={e.origPath}>
                          ← {e.origPath}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-[var(--oc-text-subtle)] hover:text-[var(--oc-text)]"
                        title="Open file"
                        disabled={busy}
                        onClick={() => void openFile(workspaceId, workspaceRoot, e.path)}
                      >
                        <FileText className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-[var(--oc-text-subtle)] hover:text-[var(--oc-text)]"
                        title="Stage"
                        disabled={busy}
                        onClick={() => void run(() => scmStage(workspaceRoot, [e.path]))}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-[var(--oc-text-subtle)] hover:text-[var(--oc-warning)]"
                        title={e.untracked ? "Delete untracked" : "Discard changes"}
                        disabled={busy}
                        onClick={() => onDiscard(e)}
                      >
                        {e.untracked ? <Trash2 className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--oc-border)] bg-[#121212] p-2">
        {workspace?.prUrl ? (
          /* ── PR is open/merged/closed: show PR actions instead of commit ── */
          <div className="flex flex-col gap-2">
            {workspace.prState === "merged" ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 w-full gap-2 bg-purple-600 text-[12px] font-medium text-white hover:bg-purple-500"
                  onClick={() => void open(workspace.prUrl!)}
                >
                  <GitMerge className="size-4" />
                  PR #{workspace.prNumber} Merged
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 w-full gap-1.5 bg-purple-600/20 text-[12px] font-medium text-purple-300 hover:bg-purple-600/30"
                  onClick={() => void handleArchive()}
                >
                  <Archive className="size-3.5" />
                  Archive Workspace
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 w-full gap-2 bg-purple-600 text-[12px] font-medium text-white hover:bg-purple-500"
                  onClick={() => void open(workspace.prUrl!)}
                >
                  <ExternalLink className="size-4" />
                  View PR #{workspace.prNumber}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full gap-1.5 text-[11px] text-purple-300/70 hover:text-purple-200"
                  disabled={prSending}
                  onClick={() => void handleOpenPr()}
                  title="Re-send PR instruction to update"
                >
                  <Send className="size-3" />
                  Update PR via agent
                </Button>
              </>
            )}
          </div>
        ) : (
          /* ── No PR: show commit + open PR ── */
          <>
            <textarea
              className="mb-2 min-h-[52px] w-full resize-y rounded border border-[var(--oc-border)] bg-[var(--oc-panel-elevated)] px-2 py-1.5 font-sans text-[12px] text-[var(--oc-text)] placeholder:text-[var(--oc-text-faint)] focus:border-[var(--oc-interactive)] focus:outline-none"
              placeholder="Commit message"
              rows={2}
              value={commitMessage}
              disabled={busy}
              onChange={(ev) => setCommitMessage(ev.target.value)}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 w-full text-[12px]"
              disabled={!canCommit}
              onClick={() =>
                void run(async () => {
                  await scmCommit(workspaceRoot, commitMessage);
                  setCommitMessage("");
                })
              }
            >
              Commit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-8 w-full gap-1.5 text-[12px] text-[var(--oc-text-muted)] hover:text-[var(--oc-text)]"
              disabled={prSending || busy}
              onClick={() => void handleOpenPr()}
              title="Open Pull Request (Cmd+Shift+P)"
            >
              <GitPullRequest className="size-3.5" />
              Open Pull Request
            </Button>
          </>
        )}

        {prError && (
          <div className="mt-1.5 rounded border border-red-900/40 bg-red-950/25 px-2 py-1.5 text-[11px] text-red-300/90">
            {prError}
          </div>
        )}
      </div>
    </div>
  );
}
