import { Fragment, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderTree, PanelBottom } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutAlignLeftIcon } from "@hugeicons/core-free-icons";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import type { PrContext, WorkspaceRecord } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";

interface AppHeaderProps {
  sidebarVisible: boolean;
  selectedWorkspace: WorkspaceRecord | null;
  bottomPanelOpen: boolean;
  fileTreeOpen: boolean;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onToggleFileTree: () => void;
}

export default function AppHeader({
  sidebarVisible,
  selectedWorkspace,
  bottomPanelOpen,
  fileTreeOpen,
  onToggleSidebar,
  onToggleBottomPanel,
  onToggleFileTree,
}: AppHeaderProps) {
  const [baseBranchLabel, setBaseBranchLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedWorkspace || selectedWorkspace.status !== "ready") {
      setBaseBranchLabel(null);
      return;
    }
    let cancelled = false;
    invoke<PrContext>("pr_gather_context", { workspaceId: selectedWorkspace.id })
      .then((ctx) => {
        if (!cancelled) setBaseBranchLabel(`origin/${ctx.baseBranch}`);
      })
      .catch(() => {
        if (!cancelled) setBaseBranchLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWorkspace?.id, selectedWorkspace?.status]);

  const pathSegments = useMemo(() => {
    const raw = selectedWorkspace?.workspaceContextSubpath;
    if (!raw) return [] as string[];
    return raw.split("/").filter(Boolean);
  }, [selectedWorkspace?.workspaceContextSubpath]);

  const rootCrumb = useMemo(() => {
    if (!selectedWorkspace) return null;
    if (selectedWorkspace.workspaceKind === "linked") return "local";
    return selectedWorkspace.name;
  }, [selectedWorkspace]);

  return (
    <div className="h-10 flex items-center shrink-0 border-b border-[var(--theme-border)] bg-[#121212]">
      {!sidebarVisible && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="ml-20"
        >
           <HugeiconsIcon icon={LayoutAlignLeftIcon} strokeWidth={1.25} className="size-5" />
        </Button>
      )}

      {selectedWorkspace && rootCrumb && (
        <div className="ml-3 flex min-w-0 items-center" data-tauri-drag-region>
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap gap-1.5 overflow-hidden text-sm text-[var(--theme-text-muted)]">
              <BreadcrumbItem>
                <BreadcrumbPage className="font-normal text-[var(--theme-text-muted)]">
                  {rootCrumb}
                </BreadcrumbPage>
              </BreadcrumbItem>
              {pathSegments.map((segment, i) => (
                <Fragment key={`${segment}-${i}`}>
                  <BreadcrumbSeparator className="text-[var(--theme-text-faint)] [&>svg]:text-[var(--theme-text-faint)]" />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="truncate font-normal text-[var(--theme-text-muted)]">
                      {segment}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </Fragment>
              ))}
              {baseBranchLabel && (
                <Fragment key="origin-base">
                  <BreadcrumbSeparator className="text-[var(--theme-text-faint)] [&>svg]:text-[var(--theme-text-faint)]" />
                  <BreadcrumbItem className="min-w-0 max-w-[min(280px,40vw)]">
                    <BreadcrumbPage className="block truncate font-normal text-[var(--theme-text-muted)]">
                      {baseBranchLabel}
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </Fragment>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      )}

      <div className="flex-1 min-w-8 self-stretch" data-tauri-drag-region />

      {selectedWorkspace?.status === "ready" && (
        <div className="mr-3 flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleBottomPanel}
            className={cn(
              bottomPanelOpen && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)] hover:bg-[var(--theme-panel-elevated)]",
            )}
            title="Toggle terminal panel (Ctrl+`)"
          >
            <PanelBottom className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleFileTree}
            className={cn(
              fileTreeOpen && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)] hover:bg-[var(--theme-panel-elevated)]",
            )}
            title="Toggle file tree"
          >
            <FolderTree className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
