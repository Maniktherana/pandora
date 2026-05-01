import { memo, useCallback, useEffect, useRef, useState } from "react";
import ProjectTerminalView from "./project-terminal/project-terminal-view";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useSelectedProject, useSelectedWorkspace, useSelectedWorkspaceId } from "@/hooks/use-navigation";
import { useProjectTerminalActions, useTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { PortsTabContent } from "./ports/ports-tab-content";
import { ScriptTabContent } from "./scripts/script-tab-content";
import { BottomPanelHeader } from "./bottom-panel-header";
import type { BottomTab } from "./bottom-panel.utils";
import { useTerminalScopeStore } from "@/services/terminal/terminal-scope-store";

type BottomPanelProps = {
  onCollapse: () => void;
  onOpenProjectSettings?: (projectId: string) => void;
};

export default memo(function BottomPanel({ onCollapse, onOpenProjectSettings }: BottomPanelProps) {
  const [tab, setTab] = useState<BottomTab>("terminal");
  const previousProjectKeyRef = useRef("");
  const hadTerminalGroupsRef = useRef(false);
  const project = useSelectedProject();
  const selectedWs = useSelectedWorkspace();
  const selectedWorkspaceID = useSelectedWorkspaceId();
  const projectKey = project ? projectRuntimeKey(project.id) : "";
  const projectTerminalCommands = useProjectTerminalActions();
  const terminalCommands = useTerminalActions();
  const workspaceCommands = useWorkspaceActions();

  const hasTerminalGroups = useTerminalScopeStore(
    (s) => (s.byScopeId[projectKey]?.terminalPanel?.groups.length ?? 0) > 0,
  );
  const activePortCount = useTerminalScopeStore((s) => {
    const seen = new Set<number>();
    for (const scope of Object.values(s.byScopeId)) {
      for (const p of scope.detectedPorts) seen.add(p.port);
    }
    return seen.size;
  });

  const addProjectTerminal = useCallback(() => {
    if (!projectKey) return;
    projectTerminalCommands.createProjectTerminal(projectKey);
  }, [projectKey, projectTerminalCommands]);

  const splitActiveGroup = useCallback(() => {
    const panel = useTerminalScopeStore.getState().byScopeId[projectKey]?.terminalPanel;
    const activeGroup = panel?.groups[panel.activeGroupIndex] ?? null;
    if (!projectKey || !activeGroup) return;
    projectTerminalCommands.splitProjectTerminalGroup(projectKey, activeGroup.id);
  }, [projectKey, projectTerminalCommands]);

  useEffect(() => {
    const previousProjectKey = previousProjectKeyRef.current;
    const hadTerminalGroups = hadTerminalGroupsRef.current;
    previousProjectKeyRef.current = projectKey;
    hadTerminalGroupsRef.current = hasTerminalGroups;
    if (
      tab === "terminal" &&
      previousProjectKey === projectKey &&
      hadTerminalGroups &&
      !hasTerminalGroups
    ) {
      onCollapse();
    }
  }, [hasTerminalGroups, onCollapse, projectKey, tab]);

  if (!project || selectedWs?.status !== "ready") {
    return <div className="h-full min-h-[120px] bg-[var(--theme-bg)]" />;
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
        if (next === "setup" || next === "run" || next === "terminal" || next === "ports") {
          handleTabChange(next as BottomTab);
        }
      }}
      onPointerDownCapture={() => {
        workspaceCommands.setLayoutTargetScopeId(projectKey);
      }}
    >
      <BottomPanelHeader
        tab={tab}
        onTabChange={handleTabChange}
        onCollapse={onCollapse}
        onAddProjectTerminal={addProjectTerminal}
        onSplitActiveGroup={splitActiveGroup}
        hasTerminalGroups={hasTerminalGroups}
        activePortCount={activePortCount}
      />
      <TabsContent value="setup" className="min-h-0 flex-1 overflow-hidden m-0">
        <ScriptTabContent
          scriptKind="setup"
          projectId={project.id}
          onOpenSettings={() => onOpenProjectSettings?.(project.id)}
        />
      </TabsContent>
      <TabsContent value="run" className="min-h-0 flex-1 overflow-hidden m-0">
        <ScriptTabContent
          scriptKind="run"
          projectId={project.id}
          onOpenSettings={() => onOpenProjectSettings?.(project.id)}
        />
      </TabsContent>
      <TabsContent value="terminal" className="min-h-0 flex-1 overflow-hidden m-0">
        <ProjectTerminalView scopeId={projectKey} />
      </TabsContent>
      <TabsContent value="ports" className="min-h-0 flex-1 overflow-hidden m-0">
        <PortsTabContent />
      </TabsContent>
    </Tabs>
  );
});
