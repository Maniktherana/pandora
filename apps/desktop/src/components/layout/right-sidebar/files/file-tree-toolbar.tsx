import { HugeiconsIcon } from "@hugeicons/react";
import {
  CollapseIcon,
  FileAddIcon,
  FolderAddIcon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type FileTreeToolbarProps = {
  workspaceTreeLabel: string;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRefreshExplorer: () => void;
  onCollapseAll: () => void;
};

export function FileTreeToolbar({
  workspaceTreeLabel,
  onCreateFile,
  onCreateFolder,
  onRefreshExplorer,
  onCollapseAll,
}: FileTreeToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-[var(--theme-text-subtle)]">
      <span className="truncate font-medium">{workspaceTreeLabel}</span>
      <TooltipProvider>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={<Button type="button" variant="ghost" size="icon-xs" aria-label="New file" />}
              onClick={onCreateFile}
            >
              <HugeiconsIcon icon={FileAddIcon} strokeWidth={1.5} className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>New file</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button type="button" variant="ghost" size="icon-xs" aria-label="New folder" />
              }
              onClick={onCreateFolder}
            >
              <HugeiconsIcon icon={FolderAddIcon} strokeWidth={1.5} className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>New folder</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Refresh explorer"
                />
              }
              onClick={onRefreshExplorer}
            >
              <HugeiconsIcon icon={Refresh01Icon} strokeWidth={1.5} className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Refresh explorer</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button type="button" variant="ghost" size="icon-xs" aria-label="Collapse all" />
              }
              onClick={onCollapseAll}
            >
              <HugeiconsIcon icon={CollapseIcon} strokeWidth={1.5} className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>Collapse all</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
