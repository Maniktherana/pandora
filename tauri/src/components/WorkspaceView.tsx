import { useCallback, useState } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import NativeTerminalSurface from "@/components/Terminal";
import TabBar from "@/components/TabBar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import type { LayoutNode, LayoutLeaf, LayoutAxis } from "@/lib/types";
import { RotateCcw, Trash2 } from "lucide-react";

interface PaneViewProps {
  leaf: LayoutLeaf;
  isFocused: boolean;
  workspaceId: string;
}

type DropZone = "center" | "left" | "right" | "top" | "bottom" | null;

function PaneView({ leaf, isFocused, workspaceId }: PaneViewProps) {
  const { setFocusedPane, setNavigationArea, slotsByID, sessionsByID, splitPane, addTabToPane } =
    useWorkspaceStore();
  const slotsMap = slotsByID(workspaceId);
  const sessionsMap = sessionsByID(workspaceId);
  const activeSlotID = leaf.slotIDs[leaf.selectedIndex] ?? leaf.slotIDs[0];
  const slot = activeSlotID ? slotsMap[activeSlotID] : null;
  const [dropZone, setDropZone] = useState<DropZone>(null);

  // Find the running session for the active slot (used for fallback display)
  const session = Object.values(sessionsMap).find(
    (s) => s.slotID === activeSlotID && s.status === "running"
  );

  const handleFocus = useCallback(() => {
    setFocusedPane(leaf.id);
    setNavigationArea("workspace");
  }, [leaf.id, setFocusedPane, setNavigationArea]);

  // Drop zone detection for edge splits
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const edgeThreshold = 0.25;

    if (x < edgeThreshold) setDropZone("left");
    else if (x > 1 - edgeThreshold) setDropZone("right");
    else if (y < edgeThreshold) setDropZone("top");
    else if (y > 1 - edgeThreshold) setDropZone("bottom");
    else setDropZone("center");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const slotID = e.dataTransfer.getData("text/plain");
    if (!slotID || !dropZone) return;

    const zone = dropZone;
    setDropZone(null);

    if (zone === "center") {
      addTabToPane(leaf.id, slotID);
    } else {
      const axisMap: Record<string, LayoutAxis> = {
        left: "horizontal",
        right: "horizontal",
        top: "vertical",
        bottom: "vertical",
      };
      const posMap: Record<string, "before" | "after"> = {
        left: "before",
        right: "after",
        top: "before",
        bottom: "after",
      };
      splitPane(leaf.id, slotID, axisMap[zone], posMap[zone]);
    }
  }, [dropZone, leaf.id, addTabToPane, splitPane]);

  return (
    <div
      className={cn(
        "flex flex-col h-full overflow-hidden rounded-sm relative",
        isFocused && "ring-1 ring-blue-500/40"
      )}
      onDragOver={handleDragOver}
      onDragLeave={() => setDropZone(null)}
      onDrop={handleDrop}
    >
      <TabBar
        paneID={leaf.id}
        slotIDs={leaf.slotIDs}
        selectedIndex={leaf.selectedIndex}
        isFocused={isFocused}
        workspaceId={workspaceId}
      />

      <div className="flex-1 min-h-0 bg-[#0a0a0a] relative">
        {leaf.slotIDs.map((slotID, idx) => {
          const isActiveTab = idx === leaf.selectedIndex;
          const sessionForSlot = Object.values(sessionsMap).find(
            (s) => s.slotID === slotID && s.status === "running"
          );
          if (!sessionForSlot) return null;
          return (
            <div
              key={slotID}
              className="absolute inset-0"
              style={{ display: isActiveTab ? "block" : "none" }}
            >
              <NativeTerminalSurface
                surfaceId={`${leaf.id}-${slotID}`}
                sessionID={sessionForSlot.id}
                workspaceId={workspaceId}
                visible={isActiveTab}
                focused={isFocused && isActiveTab}
                onFocus={handleFocus}
              />
            </div>
          );
        })}
        {/* Fallback when no session exists */}
        {!Object.values(sessionsMap).some(s => leaf.slotIDs.includes(s.slotID) && s.status === "running") && (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            {slot ? (
              <span>{slot.aggregateStatus === "stopped" ? "Terminal stopped" : "Connecting..."}</span>
            ) : (
              <span>No terminal</span>
            )}
          </div>
        )}
      </div>

      {/* Drop zone overlay */}
      {dropZone && (
        <div
          className={cn(
            "absolute pointer-events-none border-2 border-blue-500/50 bg-blue-500/10 rounded",
            dropZone === "center" && "inset-0",
            dropZone === "left" && "inset-y-0 left-0 w-1/2",
            dropZone === "right" && "inset-y-0 right-0 w-1/2",
            dropZone === "top" && "inset-x-0 top-0 h-1/2",
            dropZone === "bottom" && "inset-x-0 bottom-0 h-1/2"
          )}
        />
      )}
    </div>
  );
}

interface LayoutRendererProps {
  node: LayoutNode;
  focusedPaneID: string | null;
  workspaceId: string;
}

function LayoutRenderer({ node, focusedPaneID, workspaceId }: LayoutRendererProps) {
  if (node.type === "leaf") {
    return <PaneView leaf={node} isFocused={node.id === focusedPaneID} workspaceId={workspaceId} />;
  }

  const direction = node.axis === "horizontal" ? "horizontal" : "vertical";

  return (
    <ResizablePanelGroup direction={direction}>
      {node.children.map((child, i) => (
        <div key={child.id} className="contents">
          {i > 0 && (
            <ResizableHandle className="bg-neutral-800 hover:bg-blue-500/50 transition-colors" />
          )}
          <ResizablePanel defaultSize={node.ratios[i] * 100} minSize={10}>
            <LayoutRenderer node={child} focusedPaneID={focusedPaneID} workspaceId={workspaceId} />
          </ResizablePanel>
        </div>
      ))}
    </ResizablePanelGroup>
  );
}

function EmptyWorkspaceState() {
  const { selectedWorkspace, selectedProject } = useWorkspaceStore();
  const workspace = selectedWorkspace();

  if (!workspace) {
    const project = selectedProject();
    if (!project) {
      return (
        <div className="flex items-center justify-center h-full text-neutral-600">
          <div className="text-center">
            <p className="text-lg font-medium">No project selected</p>
            <p className="text-sm mt-1">Add a project from the sidebar to get started</p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-neutral-600">
        <div className="text-center">
          <p className="text-lg font-medium">No workspace selected</p>
          <p className="text-sm mt-1">Create a workspace in the sidebar</p>
        </div>
      </div>
    );
  }

  if (workspace.status === "creating") {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-neutral-600 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Creating workspace...</p>
          <p className="text-xs text-neutral-600 mt-1">Setting up git worktree</p>
        </div>
      </div>
    );
  }

  if (workspace.status === "failed") {
    const { retryWorkspace, removeWorkspace } = useWorkspaceStore.getState();
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        <div className="text-center max-w-md">
          <p className="text-sm text-red-400">Workspace creation failed</p>
          {workspace.failureMessage && (
            <p className="text-xs text-neutral-600 mt-1 break-words">{workspace.failureMessage}</p>
          )}
          <div className="flex gap-2 justify-center mt-4">
            <button
              onClick={() => void retryWorkspace(workspace.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
            <button
              onClick={() => void removeWorkspace(workspace.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function WorkspaceView() {
  const selectedWorkspaceID = useWorkspaceStore((s) => s.selectedWorkspaceID);
  const selectedWs = useWorkspaceStore((s) => s.selectedWorkspace());
  const runtime = useWorkspaceStore((s) => (selectedWorkspaceID ? s.runtimes[selectedWorkspaceID] : null));

  if (!selectedWs || selectedWs.status !== "ready" || !runtime?.root) {
    return <EmptyWorkspaceState />;
  }

  return (
    <div className="h-full w-full">
      <LayoutRenderer
        node={runtime.root}
        focusedPaneID={runtime.focusedPaneID}
        workspaceId={selectedWorkspaceID!}
      />
    </div>
  );
}
