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

type CommitDropdownProps = {
  onCommit: () => Promise<void>;
  canCommit: boolean;
  busy: boolean;
  scopeId: string;
  onPush: () => Promise<void>;
  onFetch: () => Promise<void>;
  onPull: () => Promise<void>;
};

export function CommitDropdown({
  onCommit,
  canCommit,
  busy,
  onPush,
  onFetch,
  onPull,
}: CommitDropdownProps) {
  const [actionBusy, setActionBusy] = useState(false);
  const disabled = busy || actionBusy;

  const handleCommitAndPush = async () => {
    if (!canCommit) return;
    setActionBusy(true);
    try {
      await onCommit();
      await onPush();
    } finally {
      setActionBusy(false);
    }
  };

  const handleFetch = async () => {
    setActionBusy(true);
    try {
      await onFetch();
    } finally {
      setActionBusy(false);
    }
  };

  const handlePull = async () => {
    setActionBusy(true);
    try {
      await onPull();
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
