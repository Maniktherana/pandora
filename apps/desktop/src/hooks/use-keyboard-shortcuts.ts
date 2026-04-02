import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { useWorkspaceStore } from "@/stores/workspace-store";

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
  const store = useWorkspaceStore;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const {
        navigationArea,
        navigateSidebar,
        selectWorkspace,
        setNavigationArea,
        selectedWorkspaceID,
        workspaces,
      } = store.getState();

      if (e.metaKey) {
        switch (e.key) {
          case "[":
            if (e.shiftKey) {
              e.preventDefault();
              store.getState().cycleTab(-1);
            }
            break;
          case "]":
            if (e.shiftKey) {
              e.preventDefault();
              store.getState().cycleTab(1);
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
              if (ws) selectWorkspace(ws);
              setNavigationArea("workspace");
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
  }, [onCloseTab, onNewTerminal, onToggleBottomPanel, onToggleSidebar, store]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<string>("app-shortcut", (event) => {
      switch (event.payload) {
        case "close-tab":
          onCloseTab();
          break;
        case "previous-tab":
          store.getState().cycleTab(-1);
          break;
        case "next-tab":
          store.getState().cycleTab(1);
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
  }, [onCloseTab, onNewTerminal, onToggleBottomPanel, onToggleSidebar, store]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("pr-state-changed", (event) => {
      try {
        const payload = typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload;
        const { workspaceId, prState } = payload as { workspaceId: string; prState: string };
        store.getState().updateWorkspacePrState(workspaceId, prState);
      } catch {}
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [store]);
}
