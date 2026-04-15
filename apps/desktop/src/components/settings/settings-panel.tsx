import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon, IconSvgElement } from "@hugeicons/react";
import { ArrowLeft02Icon, GitBranchIcon, PaintBucketIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/shared/utils";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useDesktopView } from "@/hooks/use-desktop-view";
import AppearanceSettings from "./appearance-settings";
import GitSettings from "./git-settings";
import ProjectSettings from "./project-settings";

type StaticTab = "appearance" | "git";
type Tab = StaticTab | `project:${string}`;

interface SettingsPanelProps {
  onClose: () => void;
  sidebarWidth: number;
  activeWorkspaceId: string | null;
  activeWorkspacePath: string | null;
  initialProjectId?: string | null;
}

export default function SettingsPanel({
  onClose,
  sidebarWidth,
  activeWorkspaceId,
  activeWorkspacePath,
  initialProjectId,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>(
    initialProjectId ? `project:${initialProjectId}` : "appearance",
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const workspaceCommands = useWorkspaceActions();
  const projects = useDesktopView((view) => view.projects);
  const activeProjectId = activeTab.startsWith("project:")
    ? activeTab.slice("project:".length)
    : null;
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (initialProjectId) {
      setActiveTab(`project:${initialProjectId}`);
    }
  }, [initialProjectId]);

  const tabs: { value: StaticTab; label: string; icon: IconSvgElement }[] = [
    { value: "appearance", label: "Appearance", icon: PaintBucketIcon },
    { value: "git", label: "Git & Worktrees", icon: GitBranchIcon },
  ];

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onPointerDownCapture={() => workspaceCommands.setLayoutTargetRuntimeId(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="flex h-full w-full overflow-hidden bg-transparent outline-none"
    >
      {/* Sidebar — matches workspace sidebar exactly */}
      <div
        className="relative h-full shrink-0 flex flex-col bg-transparent"
        style={{ width: sidebarWidth }}
      >
        {/* Traffic light clearance + drag region — identical to left-sidebar */}
        <div className="flex h-10 justify-end items-center px-3" data-tauri-drag-region>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="gap-1.5 px-2 text-xs text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
            style={{ marginLeft: 72 }}
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} className="size-3.5" />
            Back
          </Button>
        </div>

        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-sm font-medium text-[var(--theme-text-subtle)]">Settings</span>
        </div>

        <div className="flex-1 overflow-y-auto px-1.5 space-y-1 py-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "flex gap-3 h-9 w-full items-center rounded-md px-2.5 text-left text-sm transition-colors",
                activeTab === tab.value
                  ? "bg-[var(--theme-panel-hover)] font-medium text-[var(--theme-text)]"
                  : "text-[var(--theme-text-subtle)] hover:bg-[var(--theme-panel-hover)]",
              )}
            >
              <HugeiconsIcon icon={tab.icon} strokeWidth={1.25} className="size-4.5" />
              <span>{tab.label}</span>
            </button>
          ))}
          {projects.length > 0 && (
            <div className="px-2.5 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--theme-text-faint)]">
              Projects
            </div>
          )}
          {projects.map((project) => {
            const value = `project:${project.id}` as const;
            return (
              <button
                key={project.id}
                onClick={() => setActiveTab(value)}
                className={cn(
                  "flex gap-3 h-9 w-full items-center rounded-md px-2.5 text-left text-sm transition-colors",
                  activeTab === value
                    ? "bg-[var(--theme-panel-hover)] font-medium text-[var(--theme-text)]"
                    : "text-[var(--theme-text-subtle)] hover:bg-[var(--theme-panel-hover)]",
                )}
              >
                <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-[var(--theme-panel-elevated)] text-[10px] font-bold text-[var(--theme-text)]">
                  {project.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 truncate">{project.displayName}</span>
              </button>
            );
          })}
        </div>

        {/* Sidebar border — same as workspace sidebar resize handle visual */}
        <div className="absolute inset-y-0 right-0 w-px bg-[var(--theme-border)]" />
      </div>

      {/* Main Content — centered */}
      <div className="flex-1 overflow-y-auto bg-[var(--theme-bg)]">
        <div className="h-10 shrink-0" data-tauri-drag-region />
        <div className="mx-auto w-full max-w-2xl px-8 pb-16">
          {activeTab === "appearance" && (
            <AppearanceSettings
              activeWorkspaceId={activeWorkspaceId}
              activeWorkspacePath={activeWorkspacePath}
            />
          )}
          {activeTab === "git" && <GitSettings />}
          {activeProject && <ProjectSettings project={activeProject} />}
        </div>
      </div>
    </div>
  );
}
