import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  FileText,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { cn } from "@/lib/utils";
import {
  scmCommit,
  scmDiscardTracked,
  scmDiscardUntracked,
  scmStage,
  scmStageAll,
  scmStatus,
  scmUnstage,
  scmUnstageAll,
  type ScmStatusEntry,
} from "@/lib/scm";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { DiffSource } from "@/lib/types";

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
        "shrink-0 rounded px-1 font-mono text-[10px] font-medium text-neutral-400",
        className
      )}
    >
      {text}
    </span>
  );
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
  const addDiffTabForPath = useWorkspaceStore((s) => s.addDiffTabForPath);

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
    addDiffTabForPath(path, source);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-neutral-800 px-1.5 py-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-neutral-400 hover:text-neutral-100"
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
          className="h-7 px-2 text-[11px] text-neutral-400 hover:text-neutral-100"
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
          className="h-7 px-2 text-[11px] text-neutral-400 hover:text-neutral-100"
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
          <div className="px-2 py-2 text-xs text-neutral-500">Loading changes…</div>
        )}
        {entries && entries.length === 0 && (
          <div className="px-2 py-2 text-xs text-neutral-500">No changes</div>
        )}

        {entries && stagedList.length > 0 && (
          <Collapsible open={stagedOpen} onOpenChange={setStagedOpen}>
            <CollapsibleTrigger
              nativeButton={false}
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="group h-auto min-h-0 w-full justify-start gap-1 rounded-none py-1 pl-2 pr-1 font-normal text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200 data-[panel-open]:bg-neutral-800/40"
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
                    className="flex min-w-0 items-center gap-0.5 border-b border-neutral-800/50 py-0.5 pl-1 pr-1 last:border-b-0"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-100"
                      title="Open staged diff"
                      disabled={busy}
                      onClick={() => onOpenDiff(e.path, "staged")}
                    >
                      <FileTypeIcon path={e.path} kind="file" className="pointer-events-none" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1">
                        {e.stagedKind ? statusBadge(e.stagedKind, "bg-emerald-950/50 text-emerald-200/80") : null}
                        <button
                          type="button"
                          className="min-w-0 truncate text-left font-mono text-[11px] text-neutral-300 hover:text-neutral-100 hover:underline"
                          title={e.path}
                          disabled={busy}
                          onClick={() => onOpenDiff(e.path, "staged")}
                        >
                          {e.path}
                        </button>
                      </div>
                      {e.origPath ? (
                        <div className="truncate pl-1 font-mono text-[10px] text-neutral-600" title={e.origPath}>
                          ← {e.origPath}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-neutral-500 hover:text-neutral-200"
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
                        className="h-7 w-7 p-0 text-neutral-500 hover:text-neutral-200"
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
                  className="group h-auto min-h-0 w-full justify-start gap-1 rounded-none py-1 pl-2 pr-1 font-normal text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200 data-[panel-open]:bg-neutral-800/40"
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
                    className="flex min-w-0 items-center gap-0.5 border-b border-neutral-800/50 py-0.5 pl-1 pr-1 last:border-b-0"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 shrink-0 p-0 text-neutral-400 hover:text-neutral-100"
                      title="Open diff (working tree)"
                      disabled={busy}
                      onClick={() => onOpenDiff(e.path, "working")}
                    >
                      <FileTypeIcon path={e.path} kind="file" className="pointer-events-none" />
                    </Button>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1">
                        {e.untracked
                          ? statusBadge("?", "bg-amber-950/50 text-amber-200/80")
                          : e.worktreeKind
                            ? statusBadge(e.worktreeKind, "bg-sky-950/50 text-sky-200/80")
                            : null}
                        <button
                          type="button"
                          className="min-w-0 truncate text-left font-mono text-[11px] text-neutral-300 hover:text-neutral-100 hover:underline"
                          title={e.path}
                          disabled={busy}
                          onClick={() => onOpenDiff(e.path, "working")}
                        >
                          {e.path}
                        </button>
                      </div>
                      {e.origPath ? (
                        <div className="truncate pl-1 font-mono text-[10px] text-neutral-600" title={e.origPath}>
                          ← {e.origPath}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-neutral-500 hover:text-neutral-200"
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
                        className="h-7 w-7 p-0 text-neutral-500 hover:text-neutral-200"
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
                        className="h-7 w-7 p-0 text-neutral-500 hover:text-amber-200"
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

      <div className="shrink-0 border-t border-neutral-800 bg-neutral-950/80 p-2">
        <textarea
          className="mb-2 min-h-[52px] w-full resize-y rounded border border-neutral-800 bg-neutral-900/80 px-2 py-1.5 font-sans text-[12px] text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
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
      </div>
    </div>
  );
}
