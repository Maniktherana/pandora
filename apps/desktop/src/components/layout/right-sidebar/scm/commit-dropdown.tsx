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
import type { useGitController } from "@/services/git/use-git";

type CommitDropdownProps = {
  onCommit: () => void;
  canCommit: boolean;
  busy: boolean;
  scopeId: string;
  scm: ReturnType<typeof useGitController>;
};

export function CommitDropdown({ onCommit, canCommit, busy, scm }: CommitDropdownProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const disabled = busy || actionBusy;

  const handleCommitAndPush = () => {
    if (!canCommit) return;
    setActionBusy(true);
    try {
      onCommit();
      scm.push();
    } catch {
      // errors handled by parent
    } finally {
      setActionBusy(false);
    }
  };

  const handleFetch = () => {
    setActionBusy(true);
    try {
      scm.fetch();
    } finally {
      setActionBusy(false);
    }
  };

  const handlePull = () => {
    setActionBusy(true);
    try {
      scm.pull();
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
            onClick={handleCommitAndPush}
          >
            Commit & Push
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={disabled} onClick={handleFetch}>
            Fetch
          </DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} onClick={handlePull}>
            Pull
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
