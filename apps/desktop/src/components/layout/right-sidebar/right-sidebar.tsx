import {
  startTransition,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useQueryClient } from "@tanstack/react-query";
import { useTabDrag } from "@/components/dnd/tab-drag-provider";
import WorkspaceChangesPanel from "@/components/layout/right-sidebar/scm/workspace-changes-panel";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { useRuntimeState, useUiPreferencesView } from "@/hooks/use-desktop-view";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { cn, getParentRelPath, joinAbsolutePath } from "@/lib/shared/utils";
import { decorationForScmEntry } from "@/components/layout/right-sidebar/scm/scm.utils";
import type {
  ScmStatusEntry,
  TreeScmDecoration,
} from "@/components/layout/right-sidebar/scm/scm.types";
import type { WorkspaceRuntimeState } from "@/lib/shared/types";
import {
  loadFileTreeExpandedPaths,
  persistFileTreeExpandedPaths,
} from "@/components/layout/right-sidebar/files/files-persistence.utils";
import { findLeaf } from "@/components/layout/workspace/layout-tree";
import {
  INTERNAL_DRAG_THRESHOLD_PX,
  SUPPRESS_CLICK_MS,
  SUPPRESS_HOVER_AFTER_DRAG_MS,
  TRANSPARENT_DRAG_IMAGE,
  TREE_ROW_SELECTOR,
  type DragPointer,
  type FileTreeRowHandle,
  type InternalTreeDragSession,
  type LeftPanelMode,
  type NativeDragPayload,
  type PendingRenameState,
  type PendingPointerDrag,
  type TreeDragSession,
  type TreeDropTarget,
  type TreeRowKind,
} from "./files/files.types";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { FileTreeRow } from "./files/file-tree-row";
import { DirectoryNode } from "./files/directory-node";
import { FileTreeToolbar } from "./files/file-tree-toolbar";
import { TreeCreateInput } from "./files/tree-create-input";
import { TreeRenameInput } from "./files/tree-rename-input";
import { TreeDragOverlay } from "./files/tree-drag-overlay";
import {
  fileTreeQueryKey,
  useWorkspaceDirectoryQuery,
} from "./files/files-queries";
import { useScmStatusQuery } from "./scm/scm-queries";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import DotGridLoader from "@/components/dot-grid-loader";

function isPointerOutsideWindow(pointer: DragPointer): boolean {
  return (
    pointer.x < 0 ||
    pointer.y < 0 ||
    pointer.x > window.innerWidth ||
    pointer.y > window.innerHeight
  );
}

function isExternalFileDrag(
  event: Pick<DragEvent, "dataTransfer"> | Pick<React.DragEvent, "dataTransfer">,
): boolean {
  const types = event.dataTransfer?.types;
  return Array.isArray(types) ? types.includes("Files") : Array.from(types ?? []).includes("Files");
}

function scoreTone(tone: TreeScmDecoration["tone"]): number {
  switch (tone) {
    case "conflict":
      return 5;
    case "deleted":
      return 4;
    case "modified":
      return 3;
    case "renamed":
      return 2;
    case "added":
      return 1;
    default:
      return 0;
  }
}

function createDecorationResolver(entries: ScmStatusEntry[]) {
  const visibleEntries = entries.filter(
    (entry) => decorationForScmEntry(entry, { includeDeleted: false }).tone !== null,
  );
  const exact = new Map(
    visibleEntries.map((entry) => [
      entry.path,
      decorationForScmEntry(entry, { includeDeleted: false }),
    ]),
  );
  return (relPath: string, isDirectory: boolean, isIgnored?: boolean): TreeScmDecoration => {
    if (isIgnored) return { badge: null, tone: "ignored", dimmed: true };
    const hit = exact.get(relPath);
    if (hit) return hit;
    if (!isDirectory) return { badge: null, tone: null, dimmed: false };

    const prefix = `${relPath}/`;
    let winner: TreeScmDecoration = { badge: null, tone: null, dimmed: false };
    for (const entry of visibleEntries) {
      if (entry.path.startsWith(prefix) || entry.origPath?.startsWith(prefix)) {
        const next = decorationForScmEntry(entry, { includeDeleted: false });
        if (scoreTone(next.tone) > scoreTone(winner.tone)) {
          winner = next;
        }
      }
    }
    return winner;
  };
}

function RightSidebarPanelLoader() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-4">
      <div className="flex flex-col items-center text-center text-[var(--theme-text-faint)]">
        <DotGridLoader variant="default" gridSize={5} sizeClassName="h-8 w-8" className="opacity-90" />
      </div>
    </div>
  );
}

function selectActiveEditorPath(runtime: WorkspaceRuntimeState | null): string | null {
  if (!runtime?.root || !runtime.focusedPaneID) return null;
  const leaf = findLeaf(runtime.root, runtime.focusedPaneID);
  if (!leaf) return null;
  const tab = leaf.tabs[leaf.selectedIndex] ?? leaf.tabs[0];
  if (!tab || (tab.kind !== "editor" && tab.kind !== "diff")) return null;
  return tab.path;
}

export default function RightSidebar({
  workspaceRoot,
  workspaceId,
  workspaceName,
  projectDisplayName,
  mode,
}: {
  workspaceRoot: string;
  workspaceId: string;
  workspaceName: string;
  projectDisplayName: string;
  mode: LeftPanelMode;
}) {
  const [contextMenu, setContextMenu] = useState<{
    relPath: string;
    kind: TreeRowKind | "root";
  } | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [selectedTreeKind, setSelectedTreeKind] = useState<TreeRowKind | null>(null);
  const [pendingCreate, setPendingCreate] = useState<{
    kind: "file" | "directory";
    parentRelPath: string;
  } | null>(null);
  const [pendingRename, setPendingRename] = useState<PendingRenameState>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [pendingPointerDrag, setPendingPointerDrag] = useState<PendingPointerDrag | null>(null);
  const [dragSession, setDragSession] = useState<TreeDragSession | null>(null);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  const treeBodyRef = useRef<HTMLDivElement | null>(null);
  const expandedPathsRef = useRef(expandedPaths);
  const expansionLoadedRef = useRef(false);
  const workspaceRootRef = useRef(workspaceRoot);
  const leftModeRef = useRef(mode);
  const pendingPointerDragRef = useRef<PendingPointerDrag | null>(pendingPointerDrag);
  const dragSessionRef = useRef<TreeDragSession | null>(dragSession);
  const suppressClickUntilRef = useRef(0);
  const suppressHoverTimerRef = useRef<number | null>(null);
  const externalTargetRef = useRef<TreeDropTarget | null>(null);
  const externalLeaveTimerRef = useRef<number | null>(null);

  workspaceRootRef.current = workspaceRoot;
  leftModeRef.current = mode;
  pendingPointerDragRef.current = pendingPointerDrag;
  dragSessionRef.current = dragSession;

  const { openFile } = useEditorActions();
  const layoutCommands = useLayoutActions();
  const { startDrag } = useTabDrag();
  const queryClient = useQueryClient();
  const activePath = useRuntimeState(workspaceId, selectActiveEditorPath);
  const fileTreeOpen = useUiPreferencesView((view) => view.fileTreeOpen);
  const rootEntriesQuery = useWorkspaceDirectoryQuery({
    workspaceId,
    workspaceRoot,
    relativePath: "",
    enabled: fileTreeOpen && mode === "files",
  });
  const rootEntries = rootEntriesQuery.data ?? null;
  const rootError = rootEntriesQuery.error ? String(rootEntriesQuery.error) : null;
  const { data: scmEntries = [] } = useScmStatusQuery(workspaceRoot, {
    enabled: fileTreeOpen && mode === "files",
  });

  const refreshTree = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: fileTreeQueryKey(workspaceId, workspaceRoot),
    });
  }, [queryClient, workspaceId, workspaceRoot]);

  const suppressHoverBriefly = useCallback(() => {
    if (suppressHoverTimerRef.current !== null) {
      window.clearTimeout(suppressHoverTimerRef.current);
    }
    setHoverSuppressed(true);
    suppressHoverTimerRef.current = window.setTimeout(() => {
      setHoverSuppressed(false);
      suppressHoverTimerRef.current = null;
    }, SUPPRESS_HOVER_AFTER_DRAG_MS);
  }, []);

  const setExternalDragTarget = useCallback(
    (target: TreeDropTarget | null, pointer: DragPointer, paths?: string[]) => {
      if (externalLeaveTimerRef.current !== null) {
        window.clearTimeout(externalLeaveTimerRef.current);
        externalLeaveTimerRef.current = null;
      }
      externalTargetRef.current = target;
      setDragSession((current) => {
        if (
          current?.kind === "external-native" &&
          current.pointer.x === pointer.x &&
          current.pointer.y === pointer.y &&
          current.target?.mode === target?.mode &&
          current.target?.targetRelPath === target?.targetRelPath
        ) {
          return current;
        }
        return {
          kind: "external-native",
          paths: paths ?? (current?.kind === "external-native" ? current.paths : []),
          pointer,
          target,
        };
      });
    },
    [],
  );

  const armSuppressClick = useCallback(() => {
    suppressClickUntilRef.current = performance.now() + SUPPRESS_CLICK_MS;
  }, []);

  const shouldSuppressClick = useCallback(
    () => performance.now() < suppressClickUntilRef.current,
    [],
  );

  const onOpenContextMenu = useCallback(
    (_clientX: number, _clientY: number, relPath: string, kind: TreeRowKind) => {
      setContextMenu({ relPath, kind });
    },
    [],
  );

  const computeDropTargetFromTreeElement = useCallback((element: Element | null): TreeDropTarget => {
    const body = treeBodyRef.current;
    if (!body || !element || !body.contains(element)) {
      return { mode: "root", targetRelPath: null };
    }

    const row = element.closest<HTMLElement>(TREE_ROW_SELECTOR);
    if (!row || !body.contains(row)) {
      return { mode: "root", targetRelPath: null };
    }

    const relPath = row.dataset.treeRowPath ?? null;
    const rowKind = row.dataset.treeRowKind as TreeRowKind | undefined;
    const parentRelPath = row.dataset.treeParentPath ?? "";
    if (!relPath || !rowKind) {
      return { mode: "root", targetRelPath: null };
    }

    if (rowKind === "directory") {
      return { mode: "directory", targetRelPath: relPath };
    }

    return { mode: "directory", targetRelPath: parentRelPath };
  }, []);

  const computeDropTargetFromPoint = useCallback(
    (clientX: number, clientY: number): TreeDropTarget | null => {
      const body = treeBodyRef.current;
      if (!body) return null;

      const bodyRect = body.getBoundingClientRect();
      if (
        clientX < bodyRect.left ||
        clientX > bodyRect.right ||
        clientY < bodyRect.top ||
        clientY > bodyRect.bottom
      ) {
        return null;
      }

      const hit = document.elementFromPoint(clientX, clientY);
      return computeDropTargetFromTreeElement(hit instanceof Element ? hit : null);
    },
    [computeDropTargetFromTreeElement],
  );

  const computeDropTargetFromDragEvent = useCallback(
    (event: React.DragEvent): TreeDropTarget | null => {
      const body = treeBodyRef.current;
      if (!body) return null;

      if (!body.contains(event.target as Node)) {
        return computeDropTargetFromPoint(event.clientX, event.clientY);
      }

      return computeDropTargetFromTreeElement(
        event.target instanceof Element ? event.target : null,
      );
    },
    [computeDropTargetFromPoint, computeDropTargetFromTreeElement],
  );

  const isPointWithinTreeBody = useCallback((clientX: number, clientY: number) => {
    const body = treeBodyRef.current;
    if (!body) return false;
    const bodyRect = body.getBoundingClientRect();
    return (
      clientX >= bodyRect.left &&
      clientX <= bodyRect.right &&
      clientY >= bodyRect.top &&
      clientY <= bodyRect.bottom
    );
  }, []);

  const isPointWithinWorkspaceDropRoot = useCallback(
    (clientX: number, clientY: number) => {
      const roots = document.querySelectorAll<HTMLElement>("[data-workspace-drop-root='true']");
      for (const root of roots) {
        if (root.dataset.workspaceId !== workspaceId) continue;
        const rect = root.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          return true;
        }
      }
      return false;
    },
    [workspaceId],
  );

  const resolveDestinationDirectory = useCallback(
    (target: TreeDropTarget | null): string | null => {
      if (!target) return null;
      switch (target.mode) {
        case "root":
          return "";
        case "directory":
          return target.targetRelPath ?? null;
      }
    },
    [],
  );

  const clearPointerDragState = useCallback(() => {
    setPendingPointerDrag(null);
    setDragSession((current) => (current?.kind === "internal" ? null : current));
    suppressHoverBriefly();
  }, [suppressHoverBriefly]);

  const clearAllDragState = useCallback(() => {
    setPendingPointerDrag(null);
    setDragSession(null);
    externalTargetRef.current = null;
    if (externalLeaveTimerRef.current !== null) {
      window.clearTimeout(externalLeaveTimerRef.current);
      externalLeaveTimerRef.current = null;
    }
    suppressHoverBriefly();
  }, [suppressHoverBriefly]);

  const clearExternalDragVisualState = useCallback(() => {
    setDragSession((current) => (current?.kind === "external-native" ? null : current));
    if (externalLeaveTimerRef.current !== null) {
      window.clearTimeout(externalLeaveTimerRef.current);
      externalLeaveTimerRef.current = null;
    }
    suppressHoverBriefly();
  }, [suppressHoverBriefly]);

  const performInternalMove = useCallback(
    async (sourceRelPath: string, sourceKind: TreeRowKind, target: TreeDropTarget | null) => {
      const destRelativePath = resolveDestinationDirectory(target);
      if (destRelativePath === null) return;

      if (destRelativePath === getParentRelPath(sourceRelPath)) {
        return;
      }
      if (sourceKind === "directory") {
        if (
          destRelativePath === sourceRelPath ||
          destRelativePath.startsWith(`${sourceRelPath}/`)
        ) {
          return;
        }
      }

      await invoke("move_within_workspace", {
        workspaceRoot,
        sourceRelativePath: sourceRelPath,
        destRelativePath,
      });
      refreshTree();
    },
    [refreshTree, resolveDestinationDirectory, workspaceRoot],
  );

  const startNativeFileDrag = useCallback(async (sourceAbsPath: string) => {
    await invoke("plugin:drag|start_drag", {
      item: [sourceAbsPath],
      image: TRANSPARENT_DRAG_IMAGE,
      options: { mode: "copy" },
      onEvent: new Channel(() => {}),
    });
  }, []);

  const handoffInternalDragToNative = useCallback(
    async (session: InternalTreeDragSession) => {
      armSuppressClick();
      clearAllDragState();
      try {
        await startNativeFileDrag(session.sourceAbsPath);
      } catch (error) {
        console.error(error);
      } finally {
        refreshTree();
      }
    },
    [armSuppressClick, clearAllDragState, refreshTree, startNativeFileDrag],
  );

  const onRowPointerDown = useCallback(
    (event: React.PointerEvent, handle: FileTreeRowHandle) => {
      if (event.button !== 0 || mode !== "files") return;
      setSelectedTreePath(handle.relPath);
      setSelectedTreeKind(handle.kind);
      setPendingPointerDrag({
        sourceRelPath: handle.relPath,
        sourceAbsPath: handle.absolutePath,
        sourceKind: handle.kind,
        label: handle.label,
        startPointer: { x: event.clientX, y: event.clientY },
      });
      setDragSession((current) => (current?.kind === "external-native" ? null : current));
    },
    [mode],
  );

  const onRowClickCapture = useCallback(
    (event: React.MouseEvent) => {
      if (!shouldSuppressClick()) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [shouldSuppressClick],
  );

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const path = selectedTreePath ?? activePath;
      if (!path) return;

      if (event.key === "Backspace" && event.metaKey) {
        event.preventDefault();
        void invoke("delete_workspace_entry", {
          workspaceRoot,
          relativePath: path,
        })
          .then(refreshTree)
          .catch(console.error);
        return;
      }

      if (event.key === "c" && event.metaKey && !event.shiftKey) {
        event.preventDefault();
        setCopiedPath(path);
        void navigator.clipboard.writeText(path);
        return;
      }

      if (event.key === "v" && event.metaKey && !event.shiftKey) {
        event.preventDefault();
        const destDir = getParentRelPath(path);
        // Try native clipboard file paths first (e.g. from Finder), then internal copy
        void invoke<string[]>("read_clipboard_file_paths")
          .then((clipPaths) => {
            if (clipPaths.length > 0) {
              return invoke("copy_into_workspace", {
                workspaceRoot,
                destRelativePath: destDir,
                sourcePaths: clipPaths,
              }).then(refreshTree);
            }
            if (copiedPath) {
              return invoke("copy_within_workspace", {
                workspaceRoot,
                sourceRelativePath: copiedPath,
                destRelativePath: destDir,
              }).then(refreshTree);
            }
          })
          .catch(console.error);
        return;
      }
    },
    [activePath, copiedPath, refreshTree, selectedTreePath, workspaceRoot],
  );

  const handleTreeDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (pendingPointerDrag || dragSession?.kind === "internal") return;
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      setExternalDragTarget(computeDropTargetFromDragEvent(event), {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [computeDropTargetFromDragEvent, dragSession?.kind, pendingPointerDrag, setExternalDragTarget],
  );

  const handleTreeDragOver = useCallback(
    (event: React.DragEvent) => {
      if (pendingPointerDrag || dragSession?.kind === "internal") return;
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      setExternalDragTarget(computeDropTargetFromDragEvent(event), {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [computeDropTargetFromDragEvent, dragSession?.kind, pendingPointerDrag, setExternalDragTarget],
  );

  const handleTreeDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (pendingPointerDrag || dragSession?.kind === "internal") return;
      if (!isExternalFileDrag(event)) return;
      if (isPointWithinTreeBody(event.clientX, event.clientY)) return;
      if (externalLeaveTimerRef.current !== null) {
        window.clearTimeout(externalLeaveTimerRef.current);
      }
      externalLeaveTimerRef.current = window.setTimeout(() => {
        clearAllDragState();
        externalLeaveTimerRef.current = null;
      }, 60);
    },
    [clearAllDragState, dragSession?.kind, isPointWithinTreeBody, pendingPointerDrag],
  );

  const handleTreeDrop = useCallback(
    (event: React.DragEvent) => {
      if (pendingPointerDrag || dragSession?.kind === "internal") return;
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      externalTargetRef.current = computeDropTargetFromDragEvent(event);
      clearExternalDragVisualState();
    },
    [
      clearExternalDragVisualState,
      computeDropTargetFromDragEvent,
      dragSession?.kind,
      pendingPointerDrag,
    ],
  );

  const activeDropTarget = dragSession?.target ?? null;
  const isDragActive = pendingPointerDrag !== null || dragSession !== null;
  const isHoverSuppressed = isDragActive || hoverSuppressed;
  const targetDirectory =
    activeDropTarget?.mode === "directory" ? (activeDropTarget.targetRelPath ?? "") : null;
  const highlightedLeafDirectory =
    activeDropTarget?.mode === "root"
      ? ""
      : targetDirectory !== null &&
          (targetDirectory === "" || expandedPathsRef.current.has(targetDirectory))
        ? targetDirectory
        : null;

  useEffect(() => {
    if (!pendingPointerDrag && dragSession?.kind !== "internal") return;

    const onPointerMove = (event: PointerEvent) => {
      const pointer = { x: event.clientX, y: event.clientY };

      if (pendingPointerDrag) {
        const dx = pointer.x - pendingPointerDrag.startPointer.x;
        const dy = pointer.y - pendingPointerDrag.startPointer.y;
        if (Math.hypot(dx, dy) < INTERNAL_DRAG_THRESHOLD_PX) {
          return;
        }

        armSuppressClick();
        setDragSession({
          kind: "internal",
          sourceRelPath: pendingPointerDrag.sourceRelPath,
          sourceAbsPath: pendingPointerDrag.sourceAbsPath,
          sourceKind: pendingPointerDrag.sourceKind,
          label: pendingPointerDrag.label,
          pointer,
          target: computeDropTargetFromPoint(pointer.x, pointer.y),
        });
        setPendingPointerDrag(null);
        return;
      }

      if (dragSession?.kind !== "internal") return;
      if (event.buttons === 0) {
        clearPointerDragState();
        return;
      }
      if (isPointerOutsideWindow(pointer)) {
        void handoffInternalDragToNative(dragSession);
        return;
      }
      if (
        dragSession.sourceKind === "file" &&
        !isPointWithinTreeBody(pointer.x, pointer.y) &&
        isPointWithinWorkspaceDropRoot(pointer.x, pointer.y)
      ) {
        const nextDragSession = dragSession;
        clearPointerDragState();
        startDrag({
          kind: "file-tree-file",
          tabLabel: nextDragSession.label,
          workspaceId,
          workspaceRoot,
          relativePath: nextDragSession.sourceRelPath,
        });
        return;
      }
      setDragSession((current) =>
        current?.kind === "internal"
          ? {
              ...current,
              pointer,
              target: computeDropTargetFromPoint(pointer.x, pointer.y),
            }
          : current,
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pendingPointerDrag) {
        setPendingPointerDrag(null);
        return;
      }
      if (dragSession?.kind !== "internal") return;

      const pointer = { x: event.clientX, y: event.clientY };
      const target = computeDropTargetFromPoint(pointer.x, pointer.y) ?? dragSession.target;
      const sourceRelPath = dragSession.sourceRelPath;
      const sourceKind = dragSession.sourceKind;

      clearPointerDragState();
      void performInternalMove(sourceRelPath, sourceKind, target).catch(console.error);
    };

    const onPointerCancel = () => {
      clearPointerDragState();
    };

    const onWindowBlur = () => {
      clearPointerDragState();
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [
    armSuppressClick,
    clearPointerDragState,
    computeDropTargetFromPoint,
    dragSession,
    handoffInternalDragToNative,
    isPointWithinTreeBody,
    isPointWithinWorkspaceDropRoot,
    pendingPointerDrag,
    performInternalMove,
    startDrag,
    workspaceId,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!pendingPointerDrag && dragSession?.kind !== "internal") return;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";

    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [dragSession, pendingPointerDrag]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const toPointer = (pos: { x: number; y: number }): DragPointer => pos;

    void getCurrentWindow()
      .onDragDropEvent((event: { payload: NativeDragPayload }) => {
        if (leftModeRef.current !== "files") return;
        if (pendingPointerDragRef.current !== null || dragSessionRef.current?.kind === "internal") {
          return;
        }

        const payload = event.payload;

        if (payload.type === "enter") {
          const pointer = toPointer(payload.position);
          setExternalDragTarget(
            computeDropTargetFromPoint(pointer.x, pointer.y),
            pointer,
            payload.paths,
          );
          return;
        }

        if (payload.type === "over") {
          const pointer = toPointer(payload.position);
          setExternalDragTarget(
            computeDropTargetFromPoint(pointer.x, pointer.y),
            pointer,
          );
          return;
        }

        if (payload.type === "leave") {
          clearAllDragState();
          return;
        }

        if (payload.type !== "drop") return;

        const pointer = toPointer(payload.position);
        const target = externalTargetRef.current ??
          computeDropTargetFromPoint(pointer.x, pointer.y) ?? {
            mode: "root",
            targetRelPath: null,
          };
        const destRelativePath = resolveDestinationDirectory(target);
        clearAllDragState();

        if (destRelativePath === null) return;

        const root = workspaceRootRef.current;
        const rootPrefix = root.endsWith("/") ? root : `${root}/`;
        const externalPaths: string[] = [];
        const moves: Promise<unknown>[] = [];

        for (const path of payload.paths) {
          if (path.startsWith(rootPrefix)) {
            const sourceRelPath = path.slice(rootPrefix.length);
            if (destRelativePath === getParentRelPath(sourceRelPath)) {
              externalPaths.push(path);
              continue;
            }
            if (
              destRelativePath === sourceRelPath ||
              destRelativePath.startsWith(`${sourceRelPath}/`)
            ) {
              continue;
            }
            moves.push(
              invoke("move_within_workspace", {
                workspaceRoot: root,
                sourceRelativePath: sourceRelPath,
                destRelativePath,
              }),
            );
          } else {
            externalPaths.push(path);
          }
        }

        if (moves.length > 0) {
          void Promise.all(moves).then(refreshTree).catch(console.error);
        }
        if (externalPaths.length > 0) {
          void invoke("copy_into_workspace", {
            workspaceRoot: root,
            destRelativePath,
            sourcePaths: externalPaths,
          })
            .then(refreshTree)
            .catch(console.error);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [
    clearAllDragState,
    computeDropTargetFromPoint,
    refreshTree,
    resolveDestinationDirectory,
    setExternalDragTarget,
  ]);

  useEffect(() => {
    return () => {
      if (suppressHoverTimerRef.current !== null) {
        window.clearTimeout(suppressHoverTimerRef.current);
      }
      if (externalLeaveTimerRef.current !== null) {
        window.clearTimeout(externalLeaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    expansionLoadedRef.current = false;
    void loadFileTreeExpandedPaths(workspaceId)
      .then((paths) => {
        if (cancelled) return;
        let merged = new Set<string>();
        setExpandedPaths((current) => {
          merged = new Set(paths);
          for (const path of current) merged.add(path);
          expandedPathsRef.current = merged;
          return merged;
        });
        expansionLoadedRef.current = true;
        const workspaceID = workspaceId;
        const snapshot = new Set(merged);
        if (!cancelled) {
          void persistFileTreeExpandedPaths(workspaceID, snapshot);
        }
      })
      .catch(() => {
        if (!cancelled) expansionLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    const workspaceID = workspaceId;
    return () => {
      if (!expansionLoadedRef.current) return;
      void persistFileTreeExpandedPaths(workspaceID, expandedPathsRef.current);
    };
  }, [workspaceId]);

  const isPathExpanded = useCallback(
    (relPath: string) => expandedPathsRef.current.has(relPath),
    [],
  );

  const setPathExpanded = useCallback(
    (relPath: string, expanded: boolean) => {
      const next = new Set(expandedPathsRef.current);
      if (expanded) next.add(relPath);
      else next.delete(relPath);
      expandedPathsRef.current = next;
      if (expansionLoadedRef.current) {
        void persistFileTreeExpandedPaths(workspaceId, next);
      }
      startTransition(() => {
        setExpandedPaths(next);
      });
    },
    [workspaceId],
  );
  const resolveDecoration = useMemo(() => createDecorationResolver(scmEntries), [scmEntries]);
  const workspaceTreeLabel = `${projectDisplayName} / ${workspaceName}`;

  const resolveCreateParent = useCallback(() => {
    const path = selectedTreePath ?? activePath;
    if (!path) return "";
    if (selectedTreeKind === "directory") return path;
    return getParentRelPath(path);
  }, [activePath, selectedTreeKind, selectedTreePath]);

  const handleCreateFile = useCallback(() => {
    const parent = resolveCreateParent();
    if (parent) setPathExpanded(parent, true);
    setPendingCreate({ kind: "file", parentRelPath: parent });
  }, [resolveCreateParent, setPathExpanded]);

  const handleCreateFolder = useCallback(() => {
    const parent = resolveCreateParent();
    if (parent) setPathExpanded(parent, true);
    setPendingCreate({ kind: "directory", parentRelPath: parent });
  }, [resolveCreateParent, setPathExpanded]);

  const handleConfirmCreate = useCallback(
    (name: string, kind: "file" | "directory", parentRelPath: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setPendingCreate(null);
        return;
      }
      const relPath = parentRelPath ? `${parentRelPath}/${trimmed}` : trimmed;

      if (kind === "file") {
        void invoke("write_workspace_text_file", {
          workspaceRoot,
          relativePath: relPath,
          contents: "",
        })
          .then(() => {
            refreshTree();
            return openFile(workspaceId, workspaceRoot, relPath);
          })
          .catch(console.error);
      } else {
        void invoke("create_workspace_directory", {
          workspaceRoot,
          relativePath: relPath,
        })
          .then(refreshTree)
          .catch(console.error);
      }
      setPendingCreate(null);
    },
    [openFile, refreshTree, workspaceId, workspaceRoot],
  );

  const handleCancelCreate = useCallback(() => {
    setPendingCreate(null);
  }, []);

  const handleCollapseAll = useCallback(() => {
    const next = new Set<string>();
    expandedPathsRef.current = next;
    setExpandedPaths(next);
    if (expansionLoadedRef.current) {
      void persistFileTreeExpandedPaths(workspaceId, []);
    }
  }, [workspaceId]);

  const handleRenameEntry = useCallback(() => {
    if (!contextMenu || contextMenu.kind === "root") return;
    const sourceRelPath = contextMenu.relPath;
    const currentName = sourceRelPath.split("/").pop() ?? sourceRelPath;
    setPendingRename({
      kind: contextMenu.kind,
      relPath: sourceRelPath,
      parentRelPath: getParentRelPath(sourceRelPath),
      currentName,
    });
    setContextMenu(null);
  }, [contextMenu]);

  const handleConfirmRename = useCallback(
    (sourceRelPath: string, nextNameRaw: string) => {
      const nextName = nextNameRaw.trim();
      const currentName = sourceRelPath.split("/").pop() ?? sourceRelPath;
      if (!nextName || nextName === currentName) {
        setPendingRename(null);
        return;
      }
      if (nextName.includes("/") || nextName.includes("\\")) {
        console.error("Rename failed: name cannot contain path separators.");
        setPendingRename(null);
        return;
      }
      void invoke("rename_workspace_entry", {
        workspaceRoot,
        sourceRelativePath: sourceRelPath,
        newName: nextName,
      })
        .then(refreshTree)
        .catch(console.error);
      setPendingRename(null);
    },
    [refreshTree, workspaceRoot],
  );

  const handleCancelRename = useCallback(() => {
    setPendingRename(null);
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeContextMenu();
    },
    [closeContextMenu],
  );

  const handleTreeContextMenuCapture = useCallback((event: MouseEvent) => {
    const hit = (event.target as Element).closest?.("[data-tree-row-path]");
    if (!hit) {
      setContextMenu({ relPath: "", kind: "root" });
    }
  }, []);

  const handleContextMenuOpenDiffStaged = useCallback(() => {
    if (!contextMenu || contextMenu.kind !== "file") return;
    layoutCommands.addDiffTabForPath(contextMenu.relPath, "staged");
    closeContextMenu();
  }, [closeContextMenu, contextMenu, layoutCommands]);

  const handleContextMenuCopyRelativePath = useCallback(() => {
    if (!contextMenu || contextMenu.kind === "root") return;
    void navigator.clipboard.writeText(contextMenu.relPath);
    closeContextMenu();
  }, [closeContextMenu, contextMenu]);

  const handleContextMenuCopyPath = useCallback(() => {
    if (!contextMenu || contextMenu.kind === "root") return;
    void navigator.clipboard.writeText(joinAbsolutePath(workspaceRoot, contextMenu.relPath));
    closeContextMenu();
  }, [closeContextMenu, contextMenu, workspaceRoot]);

  const handleContextMenuCopy = useCallback(() => {
    if (!contextMenu || contextMenu.kind === "root") return;
    setCopiedPath(contextMenu.relPath);
    closeContextMenu();
  }, [closeContextMenu, contextMenu]);

  const handleContextMenuPaste = useCallback(() => {
    if (!contextMenu) return;
    const destDir =
      contextMenu.kind === "directory"
        ? contextMenu.relPath
        : contextMenu.kind === "root"
          ? ""
          : getParentRelPath(contextMenu.relPath);
    void invoke<string[]>("read_clipboard_file_paths")
      .then((clipPaths) => {
        if (clipPaths.length > 0) {
          return invoke("copy_into_workspace", {
            workspaceRoot,
            destRelativePath: destDir,
            sourcePaths: clipPaths,
          }).then(refreshTree);
        }
        if (copiedPath) {
          return invoke("copy_within_workspace", {
            workspaceRoot,
            sourceRelativePath: copiedPath,
            destRelativePath: destDir,
          }).then(refreshTree);
        }
      })
      .catch(console.error);
    closeContextMenu();
  }, [closeContextMenu, contextMenu, copiedPath, refreshTree, workspaceRoot]);

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenu || contextMenu.kind === "root") return;
    void invoke("delete_workspace_entry", {
      workspaceRoot,
      relativePath: contextMenu.relPath,
    })
      .then(refreshTree)
      .catch(console.error);
    closeContextMenu();
  }, [closeContextMenu, contextMenu, refreshTree, workspaceRoot]);

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#151515] select-none">
      {dragSession?.kind === "internal" ? <TreeDragOverlay session={dragSession} /> : null}

      {mode === "changes" ? (
        <WorkspaceChangesPanel
          workspaceRoot={workspaceRoot}
          workspaceId={workspaceId}
          workspaceLabel={workspaceTreeLabel}
        />
      ) : (
        <>
          <FileTreeToolbar
            workspaceTreeLabel={workspaceTreeLabel}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onRefreshExplorer={refreshTree}
            onCollapseAll={handleCollapseAll}
          />
          <ContextMenu
            open={contextMenu !== null}
            onOpenChange={handleContextMenuOpenChange}
          >
            <ContextMenuTrigger
              className="relative min-h-0 flex-1"
              onContextMenuCapture={handleTreeContextMenuCapture}
            >
              <div
                ref={treeBodyRef}
                data-file-tree-sidebar="true"
                tabIndex={-1}
                className="relative min-h-0 h-full overflow-auto overscroll-none px-1.5 pb-2 outline-none"
                style={{ overscrollBehavior: "none" }}
                onKeyDown={handleTreeKeyDown}
                onDragEnter={handleTreeDragEnter}
                onDragOver={handleTreeDragOver}
                onDragLeave={handleTreeDragLeave}
                onDrop={handleTreeDrop}
              >
                {rootEntries === null && rootEntriesQuery.isFetching ? <RightSidebarPanelLoader /> : null}
                {rootError ? (
                  <div className="px-2 py-2 text-xs text-[var(--theme-error)]">{rootError}</div>
                ) : null}
                {rootEntries !== null && pendingCreate && pendingCreate.parentRelPath === "" && (
                  <TreeCreateInput
                    kind={pendingCreate.kind}
                    parentRelPath={pendingCreate.parentRelPath}
                    depth={0}
                    onConfirm={handleConfirmCreate}
                    onCancel={handleCancelCreate}
                  />
                )}
                {rootEntries?.map((entry) =>
                  pendingRename?.relPath === entry.name ? (
                    <TreeRenameInput
                      key={entry.name}
                      kind={entry.isDirectory ? "directory" : "file"}
                      depth={0}
                      initialName={pendingRename.currentName}
                      sourceRelPath={pendingRename.relPath}
                      onConfirm={handleConfirmRename}
                      onCancel={handleCancelRename}
                    />
                  ) : entry.isDirectory ? (
                    <DirectoryNode
                      key={entry.name}
                      workspaceRoot={workspaceRoot}
                      workspaceId={workspaceId}
                      relPath={entry.name}
                      parentRelPath=""
                      name={entry.name}
                      depth={0}
                      isIgnored={entry.isIgnored}
                      resolveDecoration={resolveDecoration}
                      isExpanded={isPathExpanded(entry.name)}
                      isPathExpanded={isPathExpanded}
                      setPathExpanded={setPathExpanded}
                      onOpenContextMenu={onOpenContextMenu}
                      activePath={activePath}
                      highlightedLeafDirectory={highlightedLeafDirectory}
                      targetDirectory={targetDirectory}
                      isHoverSuppressed={isHoverSuppressed}
                      showDirectoryIcon={false}
                      directoryScmBadgeVariant="dot"
                      onRowPointerDown={onRowPointerDown}
                      onRowClickCapture={onRowClickCapture}
                      pendingCreate={pendingCreate}
                      onConfirmCreate={handleConfirmCreate}
                      onCancelCreate={handleCancelCreate}
                      pendingRename={pendingRename}
                      onConfirmRename={handleConfirmRename}
                      onCancelRename={handleCancelRename}
                    />
                  ) : (
                    <FileTreeRow
                      key={entry.name}
                      depth={0}
                      icon={<FileTypeIcon path={entry.name} kind="file" />}
                      label={entry.name}
                      decoration={resolveDecoration(entry.name, false, entry.isIgnored)}
                      fileRelPath={entry.name}
                      onOpenContextMenu={onOpenContextMenu}
                      active={activePath === entry.name}
                      onOpen={() => void openFile(workspaceId, workspaceRoot, entry.name)}
                      onPointerDown={onRowPointerDown}
                      onClickCapture={onRowClickCapture}
                      rowKind="file"
                      rowRelPath={entry.name}
                      parentRelPath=""
                      absolutePath={joinAbsolutePath(workspaceRoot, entry.name)}
                      highlightedLeafDirectory={highlightedLeafDirectory}
                      isHoverSuppressed={isHoverSuppressed}
                    />
                  ),
                )}
              </div>
            </ContextMenuTrigger>

            {contextMenu ? (
              <ContextMenuContent side="right" align="start" className="min-w-[200px]">
                {contextMenu.kind === "file" ? (
                  <ContextMenuItem onClick={handleContextMenuOpenDiffStaged}>
                    Open diff (staged)
                  </ContextMenuItem>
                ) : null}
                {contextMenu.kind !== "root" ? (
                  <>
                    <ContextMenuItem onClick={handleContextMenuCopyRelativePath}>
                      Copy Relative Path
                    </ContextMenuItem>
                    <ContextMenuItem onClick={handleContextMenuCopyPath}>
                      Copy Path
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={handleContextMenuCopy}>
                      Copy
                    </ContextMenuItem>
                    <ContextMenuItem onClick={handleRenameEntry}>Rename</ContextMenuItem>
                  </>
                ) : null}
                <ContextMenuItem onClick={handleContextMenuPaste}>
                  Paste
                </ContextMenuItem>
                {contextMenu.kind !== "root" ? (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onClick={handleContextMenuDelete}>
                      Delete
                    </ContextMenuItem>
                  </>
                ) : null}
              </ContextMenuContent>
            ) : null}
          </ContextMenu>
        </>
      )}
    </div>
  );
}
