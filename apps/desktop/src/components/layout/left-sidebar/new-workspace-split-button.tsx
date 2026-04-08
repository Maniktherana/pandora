import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon, ExternalDriveIcon, SplitIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/shared/utils";

type NewWorkspaceSplitButtonProps = {
  label?: string;
  defaultKind?: "worktree" | "linked";
  onCreateWorktree: () => void;
  onCreateLinked: () => void;
  className?: string;
  fullWidth?: boolean;
};

export function NewWorkspaceSplitButton({
  label = "New",
  defaultKind = "linked",
  onCreateWorktree,
  onCreateLinked,
  className,
  fullWidth = false,
}: NewWorkspaceSplitButtonProps) {
  const isWorktreeDefault = defaultKind === "worktree";

  return (
    <div className={cn("flex items-center rounded-md", fullWidth && "w-full", className)}>
      <Button
        type="button"
        variant="ghost"
        size="sidebar"
        className={cn("rounded-r-none px-1.5", fullWidth && "flex-1 justify-start px-2 gap-2")}
        onClick={isWorktreeDefault ? onCreateWorktree : onCreateLinked}
        title={isWorktreeDefault ? "New worktree" : "New local workspace"}
        aria-label={isWorktreeDefault ? "New worktree" : "New local workspace"}
      >
        <span>{label}</span>
        <HugeiconsIcon
          icon={isWorktreeDefault ? SplitIcon : ExternalDriveIcon}
          strokeWidth={2}
          className="size-4"
        />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sidebar"
              className="shrink-0 rounded-l-none text-[var(--theme-text-muted)]"
            />
          }
          title="Select workspace type"
          aria-label="Select workspace type"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            onClick={onCreateWorktree}
            className="cursor-pointer hover:bg-accent hover:text-accent-foreground"
          >
            <HugeiconsIcon icon={SplitIcon} strokeWidth={2} className="size-3.5" />
            <span>New Worktree</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={onCreateLinked}
            className="cursor-pointer hover:bg-accent hover:text-accent-foreground"
          >
            <HugeiconsIcon icon={ExternalDriveIcon} strokeWidth={2} className="size-3.5" />
            <span>New Local Workspace</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
