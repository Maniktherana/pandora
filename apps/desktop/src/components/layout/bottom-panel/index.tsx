import { useCallback, useState } from "react";
import ProjectTerminalView from "./project-terminal/project-terminal-view";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useDesktopView, useRuntimeState } from "@/hooks/use-desktop-view";
import { useProjectTerminalActions, useTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { PortsTabContent } from "./ports/ports-tab-content";
import { BottomPanelHeader } from "./bottom-panel-header";
import type { BottomTab } from "./bottom-panel.utils";

type BottomPanelProps = {
  onCollapse: () => void;
};

export default function BottomPanel({ onCollapse }: BottomPanelProps) {
  const [tab, setTab] = useState<BottomTab>("terminal");
  const project = useDesktopView((view) => view.selectedProject);
  const selectedWs = useDesktopView((view) => view.selectedWorkspace);
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const workspaceRuntime = useRuntimeState(selectedWorkspaceID ?? "");
  const projectKey = project ? projectRuntimeKey(project.id) : "";
  const projectRuntime = useRuntimeState(projectKey);
  const projectTerminalCommands = useProjectTerminalActions();
  const terminalCommands = useTerminalActions();
  const workspaceCommands = useWorkspaceActions();
  const hasTerminalGroups = (projectRuntime?.terminalPanel?.groups.length ?? 0) > 0;

  const addProjectTerminal = useCallback(() => {
    if (!projectKey) return;
    projectTerminalCommands.createProjectTerminal(projectKey);
  }, [projectKey, projectTerminalCommands]);

  const splitActiveGroup = useCallback(() => {
    const activeGroup =
      projectRuntime?.terminalPanel?.groups[projectRuntime.terminalPanel.activeGroupIndex] ?? null;
    if (!projectKey || !activeGroup) return;
    projectTerminalCommands.splitProjectTerminalGroup(projectKey, activeGroup.id);
  }, [projectKey, projectRuntime?.terminalPanel, projectTerminalCommands]);

  if (!project || selectedWs?.status !== "ready") {
    return <div className="h-full min-h-[120px] bg-[var(--theme-bg)]" />;
  }

  if (!projectRuntime) {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center bg-[var(--theme-bg)] text-sm text-[var(--theme-text-muted)]">
        Starting project shell...
      </div>
    );
  }

  const handleTabChange = (next: BottomTab) => {
    setTab(next);
    if (next === "terminal") {
      projectTerminalCommands.setProjectTerminalPanelVisible(projectKey, true);
      if (!hasTerminalGroups) {
        terminalCommands.toggleBottomPanel(false);
      }
    }
  };

  return (
    <Tabs
      value={tab}
      className="flex h-full min-h-0 flex-col gap-0 bg-[var(--theme-bg)]"
      onValueChange={(next) => {
        if (next === "terminal" || next === "ports") {
          handleTabChange(next);
        }
      }}
      onPointerDownCapture={() => {
        workspaceCommands.setLayoutTargetRuntimeId(projectKey);
      }}
    >
      <BottomPanelHeader
        tab={tab}
        onTabChange={handleTabChange}
        onCollapse={onCollapse}
        onAddProjectTerminal={addProjectTerminal}
        onSplitActiveGroup={splitActiveGroup}
        hasTerminalGroups={hasTerminalGroups}
      />
      <TabsContent value="terminal" className="min-h-0 flex-1 overflow-hidden m-0">
        <ProjectTerminalView workspaceId={projectKey} runtime={projectRuntime} />
      </TabsContent>
      <TabsContent value="ports" className="min-h-0 flex-1 overflow-hidden m-0">
        <PortsTabContent
          projectSessions={projectRuntime?.sessions ?? []}
          workspaceSessions={workspaceRuntime?.sessions ?? []}
        />
      </TabsContent>
    </Tabs>
  );
}
