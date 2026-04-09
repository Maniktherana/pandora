import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  Files02Icon,
  Folder01Icon,
  GitCompareIcon,
  GitMergeIcon,
  LayoutAlignBottomIcon,
  LayoutAlignLeftIcon,
  SidebarBottomIcon,
} from "@hugeicons/core-free-icons";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNativeTerminalOverlay } from "@/hooks/use-native-terminal-overlay";
import type { HeaderBranchContext, WorkspaceRecord } from "@/lib/shared/types";
import type { LeftPanelMode } from "@/components/layout/right-sidebar/files/files.types";
import { cn } from "@/lib/shared/utils";

const TARGET_BRANCH_STORAGE_KEY_PREFIX = "pandora.header.targetBranch.";

function loadStoredTargetBranch(workspaceId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${TARGET_BRANCH_STORAGE_KEY_PREFIX}${workspaceId}`);
  } catch {
    return null;
  }
}

function persistTargetBranch(workspaceId: string, branch: string) {
  try {
    window.localStorage.setItem(`${TARGET_BRANCH_STORAGE_KEY_PREFIX}${workspaceId}`, branch);
  } catch {
    /* ignore */
  }
}

function formatTargetBranch(branch: string | null): string {
  if (!branch) return "origin/main";
  return branch.startsWith("origin/") ? branch : `origin/${branch}`;
}

function resolveTargetBranch(ctx: HeaderBranchContext, workspaceId: string): string | null {
  const stored = loadStoredTargetBranch(workspaceId);
  if (
    stored &&
    stored !== "origin" &&
    (stored === "main" || stored !== ctx.currentBranch) &&
    (stored === "main" || ctx.availableBranches.includes(stored))
  ) {
    return stored;
  }
  if (ctx.availableBranches.includes("main") && ctx.currentBranch !== "main") {
    return "main";
  }
  if (ctx.defaultTargetBranch && ctx.defaultTargetBranch !== ctx.currentBranch) {
    return ctx.defaultTargetBranch;
  }
  return ctx.availableBranches.find((branch) => branch !== ctx.currentBranch) ?? null;
}

interface AppHeaderProps {
  booting: boolean;
  sidebarVisible: boolean;
  selectedWorkspace: WorkspaceRecord | null;
  bottomPanelOpen: boolean;
  fileTreeOpen: boolean;
  rightSidebarMode: LeftPanelMode;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onSelectRightSidebarMode: (mode: LeftPanelMode) => void;
}

export default function AppHeader({
  booting,
  sidebarVisible,
  selectedWorkspace,
  bottomPanelOpen,
  fileTreeOpen,
  rightSidebarMode,
  onToggleSidebar,
  onToggleBottomPanel,
  onSelectRightSidebarMode,
}: AppHeaderProps) {
  const [branchContext, setBranchContext] = useState<HeaderBranchContext | null>(null);
  const [targetBranch, setTargetBranch] = useState<string | null>(null);
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  useNativeTerminalOverlay(branchPickerOpen ? "opaque" : null);

  useEffect(() => {
    if (!selectedWorkspace || selectedWorkspace.status !== "ready") {
      setBranchContext(null);
      setTargetBranch(null);
      setBranchPickerOpen(false);
      setBranchSearch("");
      return;
    }
    let cancelled = false;
    invoke<HeaderBranchContext>("header_branch_context", { workspaceId: selectedWorkspace.id })
      .then((ctx) => {
        if (!cancelled) {
          setBranchContext(ctx);
          setTargetBranch(resolveTargetBranch(ctx, selectedWorkspace.id));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranchContext(null);
          setTargetBranch(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWorkspace?.id, selectedWorkspace?.status]);

  useEffect(() => {
    if (!branchPickerOpen) {
      setBranchSearch("");
    }
  }, [branchPickerOpen]);

  const ownerLabel = useMemo(() => {
    if (branchContext?.owner) return branchContext.owner;
    if (selectedWorkspace?.workspaceKind === "worktree" && selectedWorkspace.gitWorktreeOwner !== "linked") {
      return selectedWorkspace.gitWorktreeOwner;
    }
    return "github";
  }, [branchContext?.owner, selectedWorkspace?.gitWorktreeOwner, selectedWorkspace?.workspaceKind]);

  const branchOptions = useMemo(() => {
    const currentBranch = branchContext?.currentBranch ?? selectedWorkspace?.gitBranchName ?? "";
    const options = Array.from(new Set(branchContext?.availableBranches ?? []));
    return options
      .filter((branch) => branch && branch !== "origin" && (branch === "main" || branch !== currentBranch))
      .sort((a, b) => {
        if (a === "main") return -1;
        if (b === "main") return 1;
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      });
  }, [branchContext?.availableBranches, branchContext?.currentBranch, selectedWorkspace?.gitBranchName]);

  const filteredBranchOptions = useMemo(() => {
    const query = branchSearch.trim().toLowerCase();
    if (!query) return branchOptions;
    return branchOptions.filter((branch) => branch.toLowerCase().includes(query));
  }, [branchOptions, branchSearch]);

  const activeTargetBranch = targetBranch ?? branchContext?.defaultTargetBranch ?? null;

  const handleSelectTargetBranch = useCallback(
    (branch: string) => {
      if (!selectedWorkspace?.id) return;
      setTargetBranch(branch);
      persistTargetBranch(selectedWorkspace.id, branch);
      setBranchPickerOpen(false);
      setBranchSearch("");
    },
    [selectedWorkspace?.id],
  );

  return (
    <div className="h-10 flex items-center shrink-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg)]">
      {!sidebarVisible && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="ml-20"
        >
           <HugeiconsIcon icon={LayoutAlignLeftIcon} strokeWidth={1} className="size-5" />
        </Button>
      )}

      {selectedWorkspace && ownerLabel ? (
        <div className="ml-3 flex min-w-0 items-center" data-tauri-drag-region>
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap gap-1 overflow-hidden text-sm text-[var(--theme-text-subtle)]">
              <BreadcrumbItem className="min-w-0 max-w-[min(320px,40vw)]">
                <div className="flex min-w-0 items-center gap-1.5">
                  <HugeiconsIcon
                    icon={GitMergeIcon}
                    strokeWidth={1}
                    className="size-5 shrink-0 text-[var(--theme-text-subtle)]"
                  />
                  <BreadcrumbPage className="truncate text-xs font-mono font-normal text-[var(--theme-text-subtle)]">
                    {branchContext?.currentBranch ?? selectedWorkspace.gitBranchName}
                  </BreadcrumbPage>
                </div>
              </BreadcrumbItem>
              <Fragment key="target-branch">
                <BreadcrumbSeparator className="text-[var(--theme-text-faint)] ml-1 [&>svg]:text-[var(--theme-text-subtle)]" />
                <BreadcrumbItem className="min-w-0 max-w-[min(260px,34vw)]">
                  <DropdownMenu open={branchPickerOpen} onOpenChange={setBranchPickerOpen}>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="max-w-full gap-1 rounded-sm py-3 px-1.5 font-normal text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
                          disabled={branchOptions.length === 0}
                        />
                      }
                      title="Select target branch"
                      aria-label="Select target branch"
                    >
                      <span className="truncate font-mono text-xs">
                        {formatTargetBranch(activeTargetBranch)}
                      </span>
                      <HugeiconsIcon
                        icon={ArrowDown01Icon}
                        strokeWidth={1.8}
                        className="size-3.5 shrink-0"
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64 min-w-64 p-0">
                      <div className="border-b border-[var(--theme-border)] p-1">
                        <Input
                          value={branchSearch}
                          autoFocus
                          placeholder="Search branches"
                          onChange={(event) => setBranchSearch(event.target.value)}
                          onKeyDown={(event) => event.stopPropagation()}
                          className="h-7 border-[var(--theme-border)] bg-[var(--theme-panel)]"
                        />
                      </div>
                      <div
                        className="max-h-72 overflow-y-auto overscroll-contain p-1"
                        onWheelCapture={(event) => event.stopPropagation()}
                      >
                        {filteredBranchOptions.length > 0 ? (
                          filteredBranchOptions.map((branch) => (
                            <DropdownMenuItem
                              key={branch}
                              onClick={() => handleSelectTargetBranch(branch)}
                              className={cn(
                                "cursor-pointer font-mono text-[11px] hover:bg-accent hover:text-accent-foreground",
                                branch === activeTargetBranch &&
                                  "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
                              )}
                            >
                              {branch}
                            </DropdownMenuItem>
                          ))
                        ) : (
                          <div className="px-2 py-2 text-xs text-[var(--theme-text-faint)]">
                            No matching branches
                          </div>
                        )}
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </BreadcrumbItem>
              </Fragment>
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      ) : booting ? (
        <div className="ml-3 flex min-w-0 items-center gap-3 text-[var(--theme-text-subtle)]">
          <HugeiconsIcon
            icon={GitMergeIcon}
            strokeWidth={1}
            className="size-5 shrink-0 text-[var(--theme-text-subtle)]"
          />
          <div className="h-2.5 w-28 rounded-full bg-[var(--theme-panel-hover)]" />
          <div className="h-2.5 w-20 rounded-full bg-[var(--theme-panel-hover)] opacity-70" />
        </div>
      ) : null}

      <div className="flex-1 min-w-8 self-stretch" data-tauri-drag-region />

      {selectedWorkspace?.status === "ready" && (
        <div className="mr-3 flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleBottomPanel}
            className={cn("h-7 w-7 rounded-sm border border-transparent px-0",
              bottomPanelOpen && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)] hover:bg-[var(--theme-panel-hover)]",
            )}
            title="Toggle terminal panel (Ctrl+`)"
          >
            <HugeiconsIcon icon={LayoutAlignBottomIcon} strokeWidth={1.25} className="size-5" />
          </Button>
          <ToggleGroup
            type="single"
            value={fileTreeOpen ? rightSidebarMode : ""}
            onValueChange={(value) => {
              if (value === "files" || value === "changes") {
                onSelectRightSidebarMode(value);
              }
            }}
            className="border-transparent bg-transparent"
            size="sm"
          >
            <ToggleGroupItem
              value="files"
              className="h-7 w-7 px-0 data-[state=on]:border-transparent data-[state=on]:bg-[var(--theme-panel-hover)] data-[state=on]:text-[var(--theme-text)]"
              title="Toggle file tree"
              aria-label="Toggle file tree"
            >
              <HugeiconsIcon icon={Files02Icon} strokeWidth={1.25} className="size-5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="changes"
              className="h-7 w-7 px-0 data-[state=on]:border-transparent data-[state=on]:bg-[var(--theme-panel-hover)] data-[state=on]:text-[var(--theme-text)]"
              title="Toggle source control"
              aria-label="Toggle source control"
            >
              <HugeiconsIcon icon={GitCompareIcon} strokeWidth={1.25} className="size-5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
    </div>
  );
}
