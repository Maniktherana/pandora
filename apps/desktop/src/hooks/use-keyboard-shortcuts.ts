import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";

interface UseKeyboardShortcutsParams {
  onNewTerminal: () => void;
  onCloseTab: () => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
}

export default function useKeyboardShortcuts({
  onNewTerminal,
  onCloseTab,
  onToggleSidebar,
  onToggleBottomPanel,
}: UseKeyboardShortcutsParams) {
  const navigationArea = useDesktopView((view) => view.navigationArea);
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const workspaces = useDesktopView((view) => view.workspaces);
  const { activateSidebarSelection, navigateSidebar, updateWorkspacePrState } =
    useWorkspaceActions();
  const { cycleTab } = useLayoutActions();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey) {
        switch (e.key) {
          case "[":
            if (e.shiftKey) {
              e.preventDefault();
              cycleTab(-1);
            }
            break;
          case "]":
            if (e.shiftKey) {
              e.preventDefault();
              cycleTab(1);
            }
            break;
          case "ArrowLeft":
            if (navigationArea === "sidebar") {
              e.preventDefault();
            }
            break;
          case "ArrowRight":
            if (navigationArea === "sidebar" && selectedWorkspaceID) {
              e.preventDefault();
              const ws = workspaces.find((w) => w.id === selectedWorkspaceID);
              if (ws) activateSidebarSelection();
            }
            break;
          case "ArrowUp":
            if (navigationArea === "sidebar") {
              e.preventDefault();
              navigateSidebar(-1);
            }
            break;
          case "ArrowDown":
            if (navigationArea === "sidebar") {
              e.preventDefault();
              navigateSidebar(1);
            }
            break;
          case "b":
            e.preventDefault();
            onToggleSidebar();
            break;
          case "t":
            e.preventDefault();
            onNewTerminal();
            break;
          case "w":
            e.preventDefault();
            onCloseTab();
            break;
          case "p":
          case "P":
            if (e.shiftKey) {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent("pandora:open-pr"));
            }
            break;
        }
      }

      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "`") {
        e.preventDefault();
        onToggleBottomPanel();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activateSidebarSelection,
    cycleTab,
    navigationArea,
    navigateSidebar,
    onCloseTab,
    onNewTerminal,
    onToggleBottomPanel,
    onToggleSidebar,
    selectedWorkspaceID,
    workspaces,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<string>("app-shortcut", (event) => {
      switch (event.payload) {
        case "close-tab":
          onCloseTab();
          break;
        case "previous-tab":
          cycleTab(-1);
          break;
        case "next-tab":
          cycleTab(1);
          break;
        case "new-terminal":
          onNewTerminal();
          break;
        case "toggle-sidebar":
          onToggleSidebar();
          break;
        case "toggle-bottom-terminal":
          onToggleBottomPanel();
          break;
        case "open-pr":
          window.dispatchEvent(new CustomEvent("pandora:open-pr"));
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [cycleTab, onCloseTab, onNewTerminal, onToggleBottomPanel, onToggleSidebar]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("pr-state-changed", (event) => {
      try {
        const payload =
          typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
        const { workspaceId, prState } = payload as { workspaceId: string; prState: string };
        updateWorkspacePrState(workspaceId, prState);
      } catch {}
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [updateWorkspacePrState]);
}
