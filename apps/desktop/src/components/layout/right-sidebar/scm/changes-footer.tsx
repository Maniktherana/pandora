import { Archive, ExternalLink, GitMerge, GitPullRequest, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

type WorkspacePrInfo = {
  prUrl?: string | null;
  prState?: string | null;
  prNumber?: number | null;
};

type ChangesFooterProps = {
  workspace: WorkspacePrInfo | null;
  busy: boolean;
  canCommit: boolean;
  commitMessage: string;
  setCommitMessage: (value: string) => void;
  prSending: boolean;
  prError: string | null;
  onCommit: () => void;
  onOpenPr: () => void;
  onArchive: () => void;
  onOpenPrUrl: (url: string) => void;
};

export function ChangesFooter({
  workspace,
  busy,
  canCommit,
  commitMessage,
  setCommitMessage,
  prSending,
  prError,
  onCommit,
  onOpenPr,
  onArchive,
  onOpenPrUrl,
}: ChangesFooterProps) {
  return (
    <div className="shrink-0 border-t border-[var(--theme-border)] bg-[#121212] p-2">
      {workspace?.prUrl ? (
        <div className="flex flex-col gap-2">
          {workspace.prState === "merged" ? (
            <>
              <Button
                type="button"
                size="sm"
                className="h-9 w-full gap-2 bg-purple-600 text-[12px] font-medium text-white hover:bg-purple-500"
                onClick={() => onOpenPrUrl(workspace.prUrl!)}
              >
                <GitMerge className="size-4" />
                PR #{workspace.prNumber} Merged
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 w-full gap-1.5 bg-purple-600/20 text-[12px] font-medium text-purple-300 hover:bg-purple-600/30"
                onClick={onArchive}
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
                onClick={() => onOpenPrUrl(workspace.prUrl!)}
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
                onClick={onOpenPr}
                title="Re-send PR instruction to update"
              >
                <Send className="size-3" />
                Update PR via agent
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <textarea
            className="mb-2 min-h-[52px] w-full resize-y rounded border border-[var(--theme-border)] bg-[var(--theme-panel-elevated)] px-2 py-1.5 font-sans text-[12px] text-[var(--theme-text)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-interactive)] focus:outline-none"
            placeholder="Commit message"
            rows={2}
            value={commitMessage}
            disabled={busy}
            onChange={(event) => setCommitMessage(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            className="h-8 w-full text-[12px]"
            disabled={!canCommit}
            onClick={onCommit}
          >
            Commit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-8 w-full gap-1.5 text-[12px] text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
            disabled={prSending || busy}
            onClick={onOpenPr}
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
  );
}

