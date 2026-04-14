import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { scmFetch, scmPull, scmPush } from "./scm.utils";

type CommitDropdownProps = {
  onCommit: () => void;
  canCommit: boolean;
  busy: boolean;
  worktreePath: string;
};

export function CommitDropdown({ onCommit, canCommit, busy, worktreePath }: CommitDropdownProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const disabled = busy || actionBusy;

  const handleCommitAndPush = async () => {
    if (!canCommit) return;
    setActionBusy(true);
    try {
      onCommit();
      // Wait a tick for the commit to complete before pushing
      await new Promise((resolve) => setTimeout(resolve, 500));
      await scmPush(worktreePath);
    } catch {
      // errors handled by parent
    } finally {
      setActionBusy(false);
    }
  };

  const handleFetch = async () => {
    setActionBusy(true);
    try {
      await scmFetch(worktreePath);
    } catch {
      // silent
    } finally {
      setActionBusy(false);
    }
  };

  const handlePull = async () => {
    setActionBusy(true);
    try {
      await scmPull(worktreePath);
    } catch {
      // silent
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="flex w-full items-center gap-0">
      <Button
        type="button"
        size="sm"
        className="h-8 flex-1 rounded-r-none text-[12px]"
        disabled={!canCommit || disabled}
        onClick={onCommit}
      >
        Commit
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="sm"
              className="h-8 w-7 rounded-l-none border-l border-l-[var(--theme-border)] px-0"
              disabled={disabled}
            >
              <ChevronDown className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" side="top" sideOffset={4}>
          <DropdownMenuItem disabled={!canCommit || disabled} onClick={onCommit}>
            Commit
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canCommit || disabled}
            onClick={() => void handleCommitAndPush()}
          >
            Commit & Push
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={disabled} onClick={() => void handleFetch()}>
            Fetch
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} onClick={() => void handlePull()}>
            Pull
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
