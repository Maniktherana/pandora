import { useCallback } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import Terminal, { feedTerminalOutput } from "@/components/Terminal";
import TabBar from "@/components/TabBar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { cn } from "@/lib/utils";
import type { LayoutNode, LayoutLeaf } from "@/lib/types";

interface PaneViewProps {
  leaf: LayoutLeaf;
  isFocused: boolean;
}

function PaneView({ leaf, isFocused }: PaneViewProps) {
  const { setFocusedPane, setNavigationArea, slotsByID, sessions } = useWorkspaceStore();
  const slotsMap = slotsByID();
  const activeSlotID = leaf.slotIDs[leaf.selectedIndex] ?? leaf.slotIDs[0];
  const slot = activeSlotID ? slotsMap[activeSlotID] : null;

  // Find the running session for this slot
  const session = sessions.find(
    (s) => s.slotID === activeSlotID && s.status === "running"
  );

  const handleInput = useCallback(
    (data: string) => {
      if (session) {
        // Access daemon client via the global ref
        const client = (window as any).__daemonClient;
        client?.input(session.id, btoa(data));
      }
    },
    [session]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (session) {
        const client = (window as any).__daemonClient;
        client?.resize(session.id, cols, rows);
      }
    },
    [session]
  );

  const handleFocus = useCallback(() => {
    setFocusedPane(leaf.id);
    setNavigationArea("workspace");
  }, [leaf.id, setFocusedPane, setNavigationArea]);

  return (
    <div
      className={cn(
        "flex flex-col h-full overflow-hidden rounded-sm",
        isFocused && "ring-1 ring-blue-500/40"
      )}
    >
      <TabBar
        paneID={leaf.id}
        slotIDs={leaf.slotIDs}
        selectedIndex={leaf.selectedIndex}
        isFocused={isFocused}
      />

      <div className="flex-1 min-h-0 bg-[#0a0a0a]">
        {session ? (
          <Terminal
            sessionID={session.id}
            onInput={handleInput}
            onResize={handleResize}
            onFocus={handleFocus}
            isFocused={isFocused}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            {slot ? (
              <span>
                {slot.aggregateStatus === "stopped" ? "Terminal stopped" : "Connecting..."}
              </span>
            ) : (
              <span>No terminal</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface LayoutRendererProps {
  node: LayoutNode;
  focusedPaneID: string | null;
}

function LayoutRenderer({ node, focusedPaneID }: LayoutRendererProps) {
  if (node.type === "leaf") {
    return <PaneView leaf={node} isFocused={node.id === focusedPaneID} />;
  }

  const direction = node.axis === "horizontal" ? "horizontal" : "vertical";

  return (
    <ResizablePanelGroup direction={direction}>
      {node.children.map((child, i) => (
        <div key={child.id} className="contents">
          {i > 0 && <ResizableHandle className="bg-neutral-800 hover:bg-blue-500/50 transition-colors" />}
          <ResizablePanel defaultSize={node.ratios[i] * 100} minSize={10}>
            <LayoutRenderer node={child} focusedPaneID={focusedPaneID} />
          </ResizablePanel>
        </div>
      ))}
    </ResizablePanelGroup>
  );
}

export default function WorkspaceView() {
  const workspace = useWorkspaceStore((s) => s.visibleWorkspace());

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-600">
        <div className="text-center">
          <p className="text-lg font-medium">No workspace selected</p>
          <p className="text-sm mt-1">Select a workspace from the sidebar or create a new terminal</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <LayoutRenderer node={workspace.root} focusedPaneID={workspace.focusedPaneID} />
    </div>
  );
}

// Export for use by daemon client
export { feedTerminalOutput };
