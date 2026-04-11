import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useSettingsStore } from "@/state/settings-store";

interface UseKeyboardShortcutsParams {
  onNewTerminal: () => void;
  onCloseTab: () => void;
  onToggleSidebar: () => void;
  onToggleBottomPanel: () => void;
  onOpenSettings: () => void;
}

type FontZoomDirection = 1 | -1;

export function getFontZoomDirection(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}) {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) {
    return null;
  }

  switch (event.key) {
    case "=":
    case "+":
      return 1 satisfies FontZoomDirection;
    case "-":
    case "_":
      return -1 satisfies FontZoomDirection;
    default:
      return null;
  }
}

function isMonacoEditorTarget(target: EventTarget | null) {
  if (typeof Element === "undefined") return false;
  const element =
    target instanceof Element
      ? target
      : document.activeElement instanceof Element
        ? document.activeElement
        : null;
  return Boolean(element?.closest(".monaco-editor"));
}

export default function useKeyboardShortcuts({
  onNewTerminal,
  onCloseTab,
  onToggleSidebar,
  onToggleBottomPanel,
  onOpenSettings,
}: UseKeyboardShortcutsParams) {
  const lastWorkspaceShortcutRef = useRef<{ direction: -1 | 1; at: number } | null>(null);
  const navigationArea = useDesktopView((view) => view.navigationArea);
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const layoutTargetRuntimeId = useDesktopView((view) => view.layoutTargetRuntimeId);
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
  const increaseEditorFontSize = useSettingsStore((state) => state.increaseEditorFontSize);
  const decreaseEditorFontSize = useSettingsStore((state) => state.decreaseEditorFontSize);
  const increaseTerminalFontSize = useSettingsStore((state) => state.increaseTerminalFontSize);
  const decreaseTerminalFontSize = useSettingsStore((state) => state.decreaseTerminalFontSize);

  const shouldHandleWorkspaceShortcut = useCallback((direction: -1 | 1) => {
    const now = performance.now();
    const previous = lastWorkspaceShortcutRef.current;
    if (previous && previous.direction === direction && now - previous.at < 24) {
      return false;
    }
    lastWorkspaceShortcutRef.current = { direction, at: now };
    return true;
  }, []);

  const applyFontZoom = useCallback(
    (direction: FontZoomDirection, target: "editor" | "terminal") => {
      if (target === "terminal") {
        if (direction > 0) {
          increaseTerminalFontSize();
        } else {
          decreaseTerminalFontSize();
        }
        return;
      }

      if (direction > 0) {
        increaseEditorFontSize();
      } else {
        decreaseEditorFontSize();
      }
    },
    [
      decreaseEditorFontSize,
      decreaseTerminalFontSize,
      increaseEditorFontSize,
      increaseTerminalFontSize,
    ],
  );

  const resolveFontZoomTarget = useCallback(
    (eventTarget: EventTarget | null): "editor" | "terminal" | null => {
      if (layoutTargetRuntimeId) return "terminal";
      if (isMonacoEditorTarget(eventTarget)) return "editor";
      return "terminal";
    },
    [layoutTargetRuntimeId],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const zoomDirection = getFontZoomDirection(e);
      if (zoomDirection) {
        const target = resolveFontZoomTarget(e.target);
        if (target) {
          e.preventDefault();
          applyFontZoom(zoomDirection, target);
          return;
        }
      }

      // Handle settings shortcut globally (always work)
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        onOpenSettings();
        return;
      }

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
              e.stopPropagation();
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
              e.stopPropagation();
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

    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [
    activateSidebarSelection,
    applyFontZoom,
    cycleTab,
    decreaseEditorFontSize,
    decreaseTerminalFontSize,
    increaseEditorFontSize,
    increaseTerminalFontSize,
    layoutTargetRuntimeId,
    navigationArea,
    navigateSidebar,
    onCloseTab,
    onNewTerminal,
    onOpenSettings,
    onToggleBottomPanel,
    onToggleSidebar,
    resolveFontZoomTarget,
    selectedWorkspaceID,
    hasSelectedWorkspace,
    shouldHandleWorkspaceShortcut,
    switchWorkspaceRelative,
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
        case "open-settings":
          onOpenSettings();
          break;
        case "zoom-in":
          applyFontZoom(1, "terminal");
          break;
        case "zoom-out":
          applyFontZoom(-1, "terminal");
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
    applyFontZoom,
    onCloseTab,
    onOpenSettings,
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
