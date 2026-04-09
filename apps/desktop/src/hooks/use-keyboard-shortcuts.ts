import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
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
  const lastWorkspaceShortcutRef = useRef<{ direction: -1 | 1; at: number } | null>(null);
  const navigationArea = useDesktopView((view) => view.navigationArea);
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const hasSelectedWorkspace = useDesktopView(
    (view) =>
      view.selectedWorkspaceID != null &&
      view.workspaces.some((workspace) => workspace.id === view.selectedWorkspaceID),
  );
  const {
    activateSidebarSelection,
    navigateSidebar,
    switchWorkspaceRelative,
    updateWorkspacePrState,
  } = useWorkspaceActions();
  const { cycleTab } = useLayoutActions();

  const shouldHandleWorkspaceShortcut = useCallback((direction: -1 | 1) => {
    const now = performance.now();
    const previous = lastWorkspaceShortcutRef.current;
    if (previous && previous.direction === direction && now - previous.at < 24) {
      return false;
    }
    lastWorkspaceShortcutRef.current = { direction, at: now };
    return true;
  }, []);

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
              if (hasSelectedWorkspace) activateSidebarSelection();
            }
            break;
          case "ArrowUp":
            if (e.altKey) {
              e.preventDefault();
              if (!shouldHandleWorkspaceShortcut(-1)) break;
              switchWorkspaceRelative(-1);
              break;
            }
            if (navigationArea === "sidebar") {
              e.preventDefault();
              navigateSidebar(-1);
            }
            break;
          case "ArrowDown":
            if (e.altKey) {
              e.preventDefault();
              if (!shouldHandleWorkspaceShortcut(1)) break;
              switchWorkspaceRelative(1);
              break;
            }
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
    switchWorkspaceRelative,
    hasSelectedWorkspace,
    shouldHandleWorkspaceShortcut,
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
        case "previous-workspace":
          if (!shouldHandleWorkspaceShortcut(-1)) break;
          switchWorkspaceRelative(-1);
          break;
        case "next-workspace":
          if (!shouldHandleWorkspaceShortcut(1)) break;
          switchWorkspaceRelative(1);
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
  }, [
    cycleTab,
    onCloseTab,
    onNewTerminal,
    onToggleBottomPanel,
    onToggleSidebar,
    switchWorkspaceRelative,
    shouldHandleWorkspaceShortcut,
  ]);

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
