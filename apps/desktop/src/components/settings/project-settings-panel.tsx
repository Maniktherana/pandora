import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import type { ProjectRecord } from "@/lib/shared/types";
import ProjectSettings from "./project-settings";

interface ProjectSettingsPanelProps {
  projectId: string;
  onClose: () => void;
  sidebarWidth: number;
}

export default function ProjectSettingsPanel({
  projectId,
  onClose,
  sidebarWidth,
}: ProjectSettingsPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const workspaceCommands = useWorkspaceActions();
  const [project, setProject] = useState<ProjectRecord | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    invoke<ProjectRecord[]>("list_projects").then((projects) => {
      const found = projects.find((p) => p.id === projectId);
      if (found) setProject(found);
    });
  }, [projectId]);

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
          <span className="text-sm font-medium text-[var(--theme-text-subtle)]">
            {project?.displayName ?? "Project"} Settings
          </span>
        </div>

        <div className="absolute inset-y-0 right-0 w-px bg-[var(--theme-border)]" />
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto bg-[var(--theme-bg)]">
        <div className="h-10 shrink-0" data-tauri-drag-region />
        <div className="mx-auto w-full max-w-2xl px-8 pb-16">
          {project ? (
            <ProjectSettings project={project} />
          ) : (
            <div className="text-sm text-[var(--theme-text-muted)]">Loading...</div>
          )}
        </div>
      </div>
    </div>
  );
}
