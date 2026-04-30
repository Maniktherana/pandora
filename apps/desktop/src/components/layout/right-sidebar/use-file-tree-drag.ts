import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import { getParentRelPath } from "@/lib/shared/utils";
import { useFileTreeStore } from "@/services/file-tree/file-tree-store";
import type {
  DragPointer,
  FileTreeRowHandle,
  InternalTreeDragSession,
  LeftPanelMode,
  NativeDragPayload,
  PendingPointerDrag,
  TreeDragSession,
  TreeDropTarget,
} from "./files/files.types";
import {
  INTERNAL_DRAG_THRESHOLD_PX,
  SUPPRESS_CLICK_MS,
  SUPPRESS_HOVER_AFTER_DRAG_MS,
  TRANSPARENT_DRAG_IMAGE,
  TREE_ROW_SELECTOR,
} from "./files/files.types";
import type { DragState } from "@/components/dnd/tab-drag.types";

interface UseFileTreeDragParams {
  workspaceId: string;
  workspaceRoot: string;
  mode: LeftPanelMode;
  onMove: (sourceRelPath: string, destRelativePath: string) => void;
  onImportFiles: (destDir: string, paths: string[]) => void;
  startDrag: (state: DragState) => void;
}

export interface UseFileTreeDragResult {
  treeBodyRef: React.RefObject<HTMLDivElement | null>;
  dragSession: TreeDragSession | null;
  isHoverSuppressed: boolean;
  isDragActive: boolean;
  targetDirectory: string | null;
  highlightedLeafDirectory: string | null;
  activeDropTarget: TreeDropTarget | null;
  onRowPointerDown: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onRowClickCapture: (event: React.MouseEvent) => void;
  handleTreeDragEnter: (event: React.DragEvent) => void;
  handleTreeDragOver: (event: React.DragEvent) => void;
  handleTreeDragLeave: (event: React.DragEvent) => void;
  handleTreeDrop: (event: React.DragEvent) => void;
}

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

const emptySet = new Set<string>();

export function useFileTreeDrag({
  workspaceId,
  workspaceRoot,
  mode,
  onMove,
  onImportFiles,
  startDrag,
}: UseFileTreeDragParams): UseFileTreeDragResult {
  // pendingPointerDrag is a ref — never React state.
  // Writing to it on pointerdown costs zero React work.
  const pendingPointerDragRef = useRef<PendingPointerDrag | null>(null);
  const [dragSession, setDragSession] = useState<TreeDragSession | null>(null);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);

  const treeBodyRef = useRef<HTMLDivElement | null>(null);
  const workspaceRootRef = useRef(workspaceRoot);
  const modeRef = useRef(mode);
  const dragSessionRef = useRef<TreeDragSession | null>(dragSession);
  const suppressClickUntilRef = useRef(0);
  const suppressHoverTimerRef = useRef<number | null>(null);
  const externalTargetRef = useRef<TreeDropTarget | null>(null);
  const externalLeaveTimerRef = useRef<number | null>(null);
  // Stable refs for callbacks that must not appear in effect dependency arrays.
  // Updated synchronously at render time so effects always call the current version.
  const moveRef = useRef(onMove);
  const importFilesRef = useRef(onImportFiles);

  workspaceRootRef.current = workspaceRoot;
  modeRef.current = mode;
  dragSessionRef.current = dragSession;
  moveRef.current = onMove;
  importFilesRef.current = onImportFiles;

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

  const computeDropTargetFromTreeElement = useCallback(
    (element: Element | null): TreeDropTarget => {
      const body = treeBodyRef.current;
      if (!body || !element || !body.contains(element)) {
        return { mode: "root", targetRelPath: null };
      }
      const row = element.closest<HTMLElement>(TREE_ROW_SELECTOR);
      if (!row || !body.contains(row)) {
        return { mode: "root", targetRelPath: null };
      }
      const relPath = row.dataset.treeRowPath ?? null;
      const rowKind = row.dataset.treeRowKind as "file" | "directory" | undefined;
      const parentRelPath = row.dataset.treeParentPath ?? "";
      if (!relPath || !rowKind) {
        return { mode: "root", targetRelPath: null };
      }
      if (rowKind === "directory") {
        return { mode: "directory", targetRelPath: relPath };
      }
      return { mode: "directory", targetRelPath: parentRelPath };
    },
    [],
  );

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
    pendingPointerDragRef.current = null;
    setDragSession((current) => (current?.kind === "internal" ? null : current));
    suppressHoverBriefly();
  }, [suppressHoverBriefly]);

  const clearAllDragState = useCallback(() => {
    pendingPointerDragRef.current = null;
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
    (sourceRelPath: string, sourceKind: "file" | "directory", target: TreeDropTarget | null) => {
      const destRelativePath = resolveDestinationDirectory(target);
      if (destRelativePath === null) return;
      if (destRelativePath === getParentRelPath(sourceRelPath)) return;
      if (sourceKind === "directory") {
        if (
          destRelativePath === sourceRelPath ||
          destRelativePath.startsWith(`${sourceRelPath}/`)
        ) {
          return;
        }
      }
      moveRef.current(sourceRelPath, destRelativePath);
    },
    [resolveDestinationDirectory],
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
      }
    },
    [armSuppressClick, clearAllDragState, startNativeFileDrag],
  );

  /**
   * Records a drag candidate in a ref and installs lightweight imperative
   * listeners to detect whether the user drags or just clicks.
   *
   * No React state is written here. The listeners remove themselves on the
   * first pointerup (normal click) or when movement exceeds
   * INTERNAL_DRAG_THRESHOLD_PX (drag start). Only the drag-start path calls
   * setDragSession, which triggers the active-drag useEffect below.
   */
  const onRowPointerDown = useCallback(
    (event: React.PointerEvent, handle: FileTreeRowHandle) => {
      if (event.button !== 0 || mode !== "files") return;
      // Only one candidate at a time (guard against multi-touch edge cases).
      if (pendingPointerDragRef.current) return;

      // Clear any external-native session that might still be visually active.
      if (dragSessionRef.current?.kind === "external-native") {
        setDragSession(null);
      }

      pendingPointerDragRef.current = {
        sourceRelPath: handle.relPath,
        sourceAbsPath: handle.absolutePath,
        sourceKind: handle.kind,
        label: handle.label,
        startPointer: { x: event.clientX, y: event.clientY },
      };

      const removeListeners = () => {
        document.removeEventListener("pointermove", onPendingMove);
        document.removeEventListener("pointerup", onPendingUp);
        document.removeEventListener("pointercancel", onPendingCancel);
      };

      const onPendingMove = (ev: PointerEvent) => {
        const pending = pendingPointerDragRef.current;
        if (!pending) { removeListeners(); return; }
        const dx = ev.clientX - pending.startPointer.x;
        const dy = ev.clientY - pending.startPointer.y;
        if (Math.hypot(dx, dy) < INTERNAL_DRAG_THRESHOLD_PX) return;
        // Threshold exceeded: promote to a real drag session.
        removeListeners();
        pendingPointerDragRef.current = null;
        armSuppressClick();
        setDragSession({
          kind: "internal",
          sourceRelPath: pending.sourceRelPath,
          sourceAbsPath: pending.sourceAbsPath,
          sourceKind: pending.sourceKind,
          label: pending.label,
          pointer: { x: ev.clientX, y: ev.clientY },
          target: computeDropTargetFromPoint(ev.clientX, ev.clientY),
        });
      };

      const onPendingUp = () => {
        pendingPointerDragRef.current = null;
        removeListeners();
      };

      const onPendingCancel = () => {
        pendingPointerDragRef.current = null;
        removeListeners();
      };

      document.addEventListener("pointermove", onPendingMove);
      document.addEventListener("pointerup", onPendingUp);
      document.addEventListener("pointercancel", onPendingCancel);
    },
    [armSuppressClick, computeDropTargetFromPoint, mode],
  );

  const onRowClickCapture = useCallback(
    (event: React.MouseEvent) => {
      if (!shouldSuppressClick()) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [shouldSuppressClick],
  );

  const handleTreeDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (pendingPointerDragRef.current || dragSession?.kind === "internal") return;
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      setExternalDragTarget(computeDropTargetFromDragEvent(event), {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [computeDropTargetFromDragEvent, dragSession?.kind, setExternalDragTarget],
  );

  const handleTreeDragOver = useCallback(
    (event: React.DragEvent) => {
      if (pendingPointerDragRef.current || dragSession?.kind === "internal") return;
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      setExternalDragTarget(computeDropTargetFromDragEvent(event), {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [computeDropTargetFromDragEvent, dragSession?.kind, setExternalDragTarget],
  );

  const handleTreeDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (pendingPointerDragRef.current || dragSession?.kind === "internal") return;
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
    [clearAllDragState, dragSession?.kind, isPointWithinTreeBody],
  );

  const handleTreeDrop = useCallback(
    (event: React.DragEvent) => {
      if (pendingPointerDragRef.current || dragSession?.kind === "internal") return;
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      externalTargetRef.current = computeDropTargetFromDragEvent(event);
      clearExternalDragVisualState();
    },
    [
      clearExternalDragVisualState,
      computeDropTargetFromDragEvent,
      dragSession?.kind,
    ],
  );

  // Active-drag pointer tracking — only runs while an internal drag is live.
  // The pending phase (before threshold) is handled imperatively in onRowPointerDown.
  useEffect(() => {
    if (dragSession?.kind !== "internal") return;

    const onPointerMove = (event: PointerEvent) => {
      const pointer = { x: event.clientX, y: event.clientY };

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
        const nextDragSession = { ...dragSession };
        clearPointerDragState();
        startDrag({
          kind: "file-tree-file",
          tabLabel: nextDragSession.label,
          workspaceId,
          workspaceRoot: workspaceRootRef.current,
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
      if (dragSession?.kind !== "internal") return;
      const pointer = { x: event.clientX, y: event.clientY };
      const target = computeDropTargetFromPoint(pointer.x, pointer.y) ?? dragSession.target;
      const sourceRelPath = dragSession.sourceRelPath;
      const sourceKind = dragSession.sourceKind;
      clearPointerDragState();
      performInternalMove(sourceRelPath, sourceKind, target);
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
    clearPointerDragState,
    computeDropTargetFromPoint,
    dragSession,
    handoffInternalDragToNative,
    isPointWithinTreeBody,
    isPointWithinWorkspaceDropRoot,
    performInternalMove,
    startDrag,
    workspaceId,
  ]);

  // Grab cursor while an internal drag is active.
  useEffect(() => {
    if (dragSession?.kind !== "internal") return;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "grabbing";
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [dragSession]);

  // Tauri native drag-drop events
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    const toPointer = (pos: { x: number; y: number }): DragPointer => pos;

    void getCurrentWindow()
      .onDragDropEvent((event: { payload: NativeDragPayload }) => {
        if (modeRef.current !== "files") return;
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
          setExternalDragTarget(computeDropTargetFromPoint(pointer.x, pointer.y), pointer);
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
            moveRef.current(sourceRelPath, destRelativePath);
          } else {
            externalPaths.push(path);
          }
        }

        if (externalPaths.length > 0) {
          importFilesRef.current(destRelativePath, externalPaths);
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
    resolveDestinationDirectory,
    setExternalDragTarget,
    // moveRef and importFilesRef are refs — intentionally excluded so this
    // effect never re-registers the native listener on expand/collapse rerenders.
  ]);

  // Cleanup timers on unmount
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

  const activeDropTarget = dragSession?.target ?? null;
  const isDragActive = dragSession !== null;
  const isHoverSuppressed = isDragActive || hoverSuppressed;
  const targetDirectory =
    activeDropTarget?.mode === "directory" ? (activeDropTarget.targetRelPath ?? "") : null;
  const currentExpandedPaths =
    useFileTreeStore.getState().byScopeId[workspaceId]?.expandedPaths ?? emptySet;
  const highlightedLeafDirectory =
    activeDropTarget?.mode === "root"
      ? ""
      : targetDirectory !== null &&
          (targetDirectory === "" || currentExpandedPaths.has(targetDirectory))
        ? targetDirectory
        : null;

  return {
    treeBodyRef,
    dragSession,
    isHoverSuppressed,
    isDragActive,
    targetDirectory,
    highlightedLeafDirectory,
    activeDropTarget,
    onRowPointerDown,
    onRowClickCapture,
    handleTreeDragEnter,
    handleTreeDragOver,
    handleTreeDragLeave,
    handleTreeDrop,
  };
}
