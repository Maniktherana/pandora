import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Channel, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ChevronRight } from "lucide-react";
import WorkspaceChangesPanel from "@/components/scm/workspace-changes-panel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/files/file-type-icon";
import { useWorkspaceView } from "@/hooks/use-desktop-view";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { cn } from "@/lib/shared/utils";
import {
  decorationForScmEntry,
  scmToneTextClass,
  scmStatus,
  type ScmStatusEntry,
  type TreeScmDecoration,
} from "@/lib/workspace/scm";
import { loadFileTreeExpandedPaths, persistFileTreeExpandedPaths } from "@/lib/workspace/ui-persistence";
import { findLeaf } from "@/lib/layout/layout-tree";

type DirEntry = { name: string; isDirectory: boolean; isIgnored?: boolean };
type LeftPanelMode = "files" | "changes";
type TreeRowKind = "file" | "directory";
type TreeDropMode = "directory" | "root";
type TreeDropTarget = {
  mode: TreeDropMode;
  targetRelPath: string | null;
};
type DragPointer = {
  x: number;
  y: number;
};
type NativeDragPayload =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };
type PendingPointerDrag = {
  sourceRelPath: string;
  sourceAbsPath: string;
  sourceKind: TreeRowKind;
  label: string;
  startPointer: DragPointer;
};
type InternalTreeDragSession = {
  kind: "internal";
  sourceRelPath: string;
  sourceAbsPath: string;
  sourceKind: TreeRowKind;
  label: string;
  pointer: DragPointer;
  target: TreeDropTarget | null;
};
type ExternalNativeTreeDragSession = {
  kind: "external-native";
  paths: string[];
  pointer: DragPointer;
  target: TreeDropTarget | null;
};
type TreeDragSession = InternalTreeDragSession | ExternalNativeTreeDragSession;
type ExpansionCtx = {
  isPathExpanded: (relPath: string) => boolean;
  setPathExpanded: (relPath: string, expanded: boolean) => void;
};
type ScmDecorationResolver = (
  relPath: string,
  isDirectory: boolean,
  isIgnored?: boolean
) => TreeScmDecoration;
type FileTreeRowHandle = {
  kind: TreeRowKind;
  relPath: string;
  parentRelPath: string;
  label: string;
  absolutePath: string;
};
const FileTreeExpansionContext = createContext<ExpansionCtx | null>(null);

const TREE_ROW_SELECTOR = "[data-tree-row-path]";
const INTERNAL_DRAG_THRESHOLD_PX = 4;
const SUPPRESS_CLICK_MS = 400;
const SUPPRESS_HOVER_AFTER_DRAG_MS = 120;
const TRANSPARENT_DRAG_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X3s0AAAAASUVORK5CYII=";

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function getParentRelPath(relPath: string): string {
  const index = relPath.lastIndexOf("/");
  return index === -1 ? "" : relPath.slice(0, index);
}

function joinAbsolutePath(workspaceRoot: string, relPath: string): string {
  return relPath ? `${workspaceRoot}/${relPath}` : workspaceRoot;
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
  event: Pick<DragEvent, "dataTransfer"> | Pick<React.DragEvent, "dataTransfer">
): boolean {
  const types = event.dataTransfer?.types;
  return Array.isArray(types)
    ? types.includes("Files")
    : Array.from(types ?? []).includes("Files");
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

function createDecorationResolver(entries: ScmStatusEntry[]): ScmDecorationResolver {
  const visibleEntries = entries.filter(
    (entry) => decorationForScmEntry(entry, { includeDeleted: false }).tone !== null
  );
  const exact = new Map(
    visibleEntries.map((entry) => [
      entry.path,
      decorationForScmEntry(entry, { includeDeleted: false }),
    ])
  );
  return (relPath, isDirectory, isIgnored) => {
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

function useFileTreeExpansion(): ExpansionCtx {
  const ctx = useContext(FileTreeExpansionContext);
  if (!ctx) throw new Error("useFileTreeExpansion outside provider");
  return ctx;
}

function FileTreeRow({
  depth,
  icon,
  label,
  decoration,
  className,
  onOpen,
  onPointerDown,
  onClickCapture,
  fileRelPath,
  onOpenDiffMenu,
  active,
  rowKind,
  rowRelPath,
  parentRelPath,
  absolutePath,
  highlightedLeafDirectory,
  isHoverSuppressed,
}: {
  depth: number;
  icon: React.ReactNode;
  label: string;
  decoration: TreeScmDecoration;
  className?: string;
  onOpen?: () => void;
  onPointerDown?: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onClickCapture?: (event: React.MouseEvent) => void;
  fileRelPath?: string;
  onOpenDiffMenu?: (clientX: number, clientY: number, relPath: string) => void;
  active?: boolean;
  rowKind: TreeRowKind;
  rowRelPath: string;
  parentRelPath: string;
  absolutePath: string;
  highlightedLeafDirectory: string | null;
  isHoverSuppressed: boolean;
}) {
  const isHighlightedLeaf =
    rowKind === "file" &&
    highlightedLeafDirectory !== null &&
    parentRelPath === highlightedLeafDirectory;
  const handle: FileTreeRowHandle = {
    kind: rowKind,
    relPath: rowRelPath,
    parentRelPath,
    label,
    absolutePath,
  };

  const content = (
    <>
      {icon}
      <span className="truncate">{label}</span>
      {decoration.badge ? (
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-[10px] font-semibold",
            scmToneTextClass(decoration.tone, false)
          )}
        >
          {decoration.badge}
        </span>
      ) : null}
    </>
  );

  const rowClassName = cn(
    "relative flex min-w-0 w-full select-none items-center gap-1.5 rounded-sm py-1 pr-1 text-left text-xs",
    !isHoverSuppressed && "hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]",
    scmToneTextClass(decoration.tone, decoration.dimmed),
    decoration.dimmed && "opacity-55",
    active && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]",
    isHighlightedLeaf && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
    className
  );

  if (onOpen) {
    return (
      <button
        type="button"
        data-tree-row-path={rowRelPath}
        data-tree-row-kind={rowKind}
        data-tree-parent-path={parentRelPath}
        className={rowClassName}
        style={{ paddingLeft: 6 + depth * 12 }}
        onPointerDown={(event) => onPointerDown?.(event, handle)}
        onClickCapture={onClickCapture}
        onClick={onOpen}
        onContextMenu={(event) => {
          if (!fileRelPath || !onOpenDiffMenu) return;
          event.preventDefault();
          onOpenDiffMenu(event.clientX, event.clientY, fileRelPath);
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      data-tree-row-path={rowRelPath}
      data-tree-row-kind={rowKind}
      data-tree-parent-path={parentRelPath}
      className={rowClassName}
      style={{ paddingLeft: 6 + depth * 12 }}
      onPointerDown={(event) => onPointerDown?.(event, handle)}
      onClickCapture={onClickCapture}
    >
      {content}
    </div>
  );
}

function DirectoryNode({
  workspaceRoot,
  workspaceId,
  relPath,
  parentRelPath,
  name,
  depth,
  isIgnored,
  resolveDecoration,
  onOpenDiffMenu,
  activePath,
  refreshTick,
  highlightedLeafDirectory,
  targetDirectory,
  isHoverSuppressed,
  onRowPointerDown,
  onRowClickCapture,
}: {
  workspaceRoot: string;
  workspaceId: string;
  relPath: string;
  parentRelPath: string;
  name: string;
  depth: number;
  isIgnored?: boolean;
  resolveDecoration: ScmDecorationResolver;
  onOpenDiffMenu?: (clientX: number, clientY: number, fileRelPath: string) => void;
  activePath: string | null;
  refreshTick: number;
  highlightedLeafDirectory: string | null;
  targetDirectory: string | null;
  isHoverSuppressed: boolean;
  onRowPointerDown: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onRowClickCapture: (event: React.MouseEvent) => void;
}) {
  const { openFile } = useEditorActions();
  const { isPathExpanded, setPathExpanded } = useFileTreeExpansion();
  const open = isPathExpanded(relPath);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const decoration = resolveDecoration(relPath, true, isIgnored);
  const isTargetedDirectory = targetDirectory !== null && targetDirectory === relPath;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void invoke<DirEntry[]>("list_workspace_directory", {
      workspaceRoot,
      relativePath: relPath,
    })
      .then((list) => {
        if (!cancelled) {
          setChildren(list);
          setLoadError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(String(error));
          setChildren([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceRoot, relPath, refreshTick]);

  return (
    <div>
      <Collapsible open={open} onOpenChange={(next) => setPathExpanded(relPath, next)}>
        <CollapsibleTrigger
          nativeButton={false}
          render={
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "group relative h-auto min-h-0 w-full justify-start gap-1.5 rounded-sm py-1 pr-1 pl-0 text-left font-normal transition-none aria-expanded:bg-transparent dark:aria-expanded:bg-transparent",
                !isHoverSuppressed &&
                  "hover:bg-[var(--theme-panel-hover)] dark:hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)] aria-expanded:hover:bg-[var(--theme-panel-hover)] dark:aria-expanded:hover:bg-[var(--theme-panel-hover)]",
                scmToneTextClass(decoration.tone, decoration.dimmed),
                decoration.dimmed && "opacity-55",
                isTargetedDirectory &&
                  "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]"
              )}
              data-tree-row-path={relPath}
              data-tree-row-kind="directory"
              data-tree-parent-path={parentRelPath}
              style={{ paddingLeft: 6 + depth * 12 }}
              onPointerDown={(event) =>
                onRowPointerDown(event, {
                  kind: "directory",
                  relPath,
                  parentRelPath,
                  label: name,
                  absolutePath: joinAbsolutePath(workspaceRoot, relPath),
                })
              }
              onClickCapture={onRowClickCapture}
            >
              <ChevronRight className="size-3.5 shrink-0 group-data-[panel-open]:rotate-90" />
              <FileTypeIcon path={relPath} kind="directory" expanded={open} />
              <span className="truncate text-xs">{name}</span>
              {decoration.badge ? (
                <span
                  className={cn(
                    "ml-auto shrink-0 font-mono text-[10px] font-semibold",
                    scmToneTextClass(decoration.tone, false)
                  )}
                >
                  {decoration.badge}
                </span>
              ) : null}
            </Button>
          }
        />
        <CollapsibleContent noTransition>
          <div className="flex flex-col">
            {loadError && (
              <div
                className="px-2 py-1 text-[11px] text-[var(--theme-error)]"
                style={{ paddingLeft: 18 + depth * 12 }}
              >
                {loadError}
              </div>
            )}
            {children?.map((entry) =>
              entry.isDirectory ? (
                <DirectoryNode
                  key={joinRel(relPath, entry.name)}
                  workspaceRoot={workspaceRoot}
                  workspaceId={workspaceId}
                  relPath={joinRel(relPath, entry.name)}
                  parentRelPath={relPath}
                  name={entry.name}
                  depth={depth + 1}
                  isIgnored={entry.isIgnored}
                  resolveDecoration={resolveDecoration}
                  onOpenDiffMenu={onOpenDiffMenu}
                  activePath={activePath}
                  refreshTick={refreshTick}
                  highlightedLeafDirectory={highlightedLeafDirectory}
                  targetDirectory={targetDirectory}
                  isHoverSuppressed={isHoverSuppressed}
                  onRowPointerDown={onRowPointerDown}
                  onRowClickCapture={onRowClickCapture}
                />
              ) : (
                <FileTreeRow
                  key={joinRel(relPath, entry.name)}
                  depth={depth + 1}
                  icon={<FileTypeIcon path={joinRel(relPath, entry.name)} kind="file" />}
                  label={entry.name}
                  decoration={resolveDecoration(
                    joinRel(relPath, entry.name),
                    false,
                    entry.isIgnored
                  )}
                  fileRelPath={joinRel(relPath, entry.name)}
                  onOpenDiffMenu={onOpenDiffMenu}
                  active={activePath === joinRel(relPath, entry.name)}
                  onOpen={() =>
                    void openFile(workspaceId, workspaceRoot, joinRel(relPath, entry.name))
                  }
                  onPointerDown={onRowPointerDown}
                  onClickCapture={onRowClickCapture}
                  rowKind="file"
                  rowRelPath={joinRel(relPath, entry.name)}
                  parentRelPath={relPath}
                  absolutePath={joinAbsolutePath(
                    workspaceRoot,
                    joinRel(relPath, entry.name)
                  )}
                  highlightedLeafDirectory={highlightedLeafDirectory}
                  isHoverSuppressed={isHoverSuppressed}
                />
              )
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function TreeDragOverlay({
  session,
}: {
  session: InternalTreeDragSession;
}) {
  return createPortal(
    <div
      className="pointer-events-none fixed z-[10001] rounded border border-[var(--theme-border)] bg-[var(--theme-panel-elevated)] px-2.5 py-1 text-xs text-[var(--theme-text)] shadow-lg"
      style={{
        left: Math.min(session.pointer.x + 14, window.innerWidth - 220),
        top: Math.min(session.pointer.y + 16, window.innerHeight - 40),
      }}
    >
      {session.label}
    </div>,
    document.body
  );
}

export default function WorkspaceFileTreePanel({
  workspaceRoot,
  workspaceId,
}: {
  workspaceRoot: string;
  workspaceId: string;
}) {
  const [leftMode, setLeftMode] = useState<LeftPanelMode>("files");
  const [rootEntries, setRootEntries] = useState<DirEntry[] | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [diffMenu, setDiffMenu] = useState<{
    x: number;
    y: number;
    relPath: string;
  } | null>(null);
  const [scmEntries, setScmEntries] = useState<ScmStatusEntry[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [refreshTick, setRefreshTick] = useState(0);
  const [pendingPointerDrag, setPendingPointerDrag] =
    useState<PendingPointerDrag | null>(null);
  const [dragSession, setDragSession] = useState<TreeDragSession | null>(null);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  const treeBodyRef = useRef<HTMLDivElement | null>(null);
  const expandedPathsRef = useRef(expandedPaths);
  const expansionLoadedRef = useRef(false);
  const workspaceRootRef = useRef(workspaceRoot);
  const suppressClickUntilRef = useRef(0);
  const suppressHoverTimerRef = useRef<number | null>(null);
  const externalTargetRef = useRef<TreeDropTarget | null>(null);
  const externalLeaveTimerRef = useRef<number | null>(null);

  expandedPathsRef.current = expandedPaths;
  workspaceRootRef.current = workspaceRoot;

  const { openFile } = useEditorActions();
  const layoutCommands = useLayoutActions();
  const runtime = useWorkspaceView(workspaceId, (view) => view.runtime);

  const activePath = useMemo(() => {
    if (!runtime?.root || !runtime.focusedPaneID) return null;
    const leaf = findLeaf(runtime.root, runtime.focusedPaneID);
    if (!leaf) return null;
    const tab = leaf.tabs[leaf.selectedIndex] ?? leaf.tabs[0];
    if (!tab || (tab.kind !== "editor" && tab.kind !== "diff")) return null;
    return tab.path;
  }, [runtime]);

  const refreshTree = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

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
    (target: TreeDropTarget | null, pointer: DragPointer) => {
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
          paths: current?.kind === "external-native" ? current.paths : [],
          pointer,
          target,
        };
      });
    },
    []
  );

  const armSuppressClick = useCallback(() => {
    suppressClickUntilRef.current = performance.now() + SUPPRESS_CLICK_MS;
  }, []);

  const shouldSuppressClick = useCallback(
    () => performance.now() < suppressClickUntilRef.current,
    []
  );

  const onOpenDiffMenu = useCallback(
    (clientX: number, clientY: number, relPath: string) => {
      setDiffMenu({ x: clientX, y: clientY, relPath });
    },
    []
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
      if (!(hit instanceof Element) || !body.contains(hit)) {
        return { mode: "root", targetRelPath: null };
      }

      const row = hit.closest<HTMLElement>(TREE_ROW_SELECTOR);
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
    },
    []
  );

  const computeDropTargetFromNativePosition = useCallback(
    (position: { x: number; y: number }) =>
      computeDropTargetFromPoint(
        position.x / window.devicePixelRatio,
        position.y / window.devicePixelRatio
      ),
    [computeDropTargetFromPoint]
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
    []
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
    async (
      sourceRelPath: string,
      sourceKind: TreeRowKind,
      target: TreeDropTarget | null
    ) => {
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
    [refreshTree, resolveDestinationDirectory, workspaceRoot]
  );

  const startNativeFileDrag = useCallback(
    async (sourceAbsPath: string) => {
      await invoke("plugin:drag|start_drag", {
        item: [sourceAbsPath],
        image: TRANSPARENT_DRAG_IMAGE,
        options: { mode: "copy" },
        onEvent: new Channel(() => {}),
      });
    },
    []
  );

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
    [armSuppressClick, clearAllDragState, refreshTree, startNativeFileDrag]
  );

  const onRowPointerDown = useCallback(
    (event: React.PointerEvent, handle: FileTreeRowHandle) => {
      if (event.button !== 0 || leftMode !== "files") return;
      setPendingPointerDrag({
        sourceRelPath: handle.relPath,
        sourceAbsPath: handle.absolutePath,
        sourceKind: handle.kind,
        label: handle.label,
        startPointer: { x: event.clientX, y: event.clientY },
      });
      setDragSession((current) =>
        current?.kind === "external-native" ? null : current
      );
    },
    [leftMode]
  );

  const onRowClickCapture = useCallback(
    (event: React.MouseEvent) => {
      if (!shouldSuppressClick()) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [shouldSuppressClick]
  );

  const activeDropTarget = dragSession?.target ?? null;
  const isDragActive = pendingPointerDrag !== null || dragSession !== null;
  const isHoverSuppressed = isDragActive || hoverSuppressed;
  const targetDirectory =
    activeDropTarget?.mode === "directory" ? (activeDropTarget.targetRelPath ?? "") : null;
  const highlightedLeafDirectory =
    activeDropTarget?.mode === "root"
      ? ""
      : targetDirectory !== null && (targetDirectory === "" || expandedPaths.has(targetDirectory))
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
      setDragSession((current) =>
        current?.kind === "internal"
          ? {
              ...current,
              pointer,
              target: computeDropTargetFromPoint(pointer.x, pointer.y),
            }
          : current
      );
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pendingPointerDrag) {
        setPendingPointerDrag(null);
        return;
      }
      if (dragSession?.kind !== "internal") return;

      const pointer = { x: event.clientX, y: event.clientY };
      const target =
        computeDropTargetFromPoint(pointer.x, pointer.y) ?? dragSession.target;
      const sourceRelPath = dragSession.sourceRelPath;
      const sourceKind = dragSession.sourceKind;

      clearPointerDragState();
      void performInternalMove(sourceRelPath, sourceKind, target).catch(
        console.error
      );
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
    pendingPointerDrag,
    performInternalMove,
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
    void getCurrentWebview().onDragDropEvent((event: { payload: NativeDragPayload }) => {
      if (leftMode !== "files") return;
      if (dragSession?.kind === "internal") return;

      const payload = event.payload;

      if (payload.type === "enter" || payload.type === "over") {
        return;
      }

      if (payload.type === "leave") {
        clearAllDragState();
        return;
      }

      if (payload.type !== "drop") return;

      const target =
        externalTargetRef.current ?? computeDropTargetFromNativePosition(payload.position);
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
            })
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
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [
    clearAllDragState,
    computeDropTargetFromNativePosition,
    dragSession,
    leftMode,
    refreshTree,
    resolveDestinationDirectory,
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
    if (!diffMenu) return;
    const close = () => setDiffMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [diffMenu]);

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
          return merged;
        });
        expansionLoadedRef.current = true;
        const workspaceID = workspaceId;
        const snapshot = new Set(merged);
        queueMicrotask(() => {
          if (!cancelled) {
            void persistFileTreeExpandedPaths(workspaceID, snapshot);
          }
        });
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
    (relPath: string) => expandedPaths.has(relPath),
    [expandedPaths]
  );

  const setPathExpanded = useCallback(
    (relPath: string, expanded: boolean) => {
      setExpandedPaths((previous) => {
        const next = new Set(previous);
        if (expanded) next.add(relPath);
        else next.delete(relPath);
        if (expansionLoadedRef.current) {
          const workspaceID = workspaceId;
          const snapshot = new Set(next);
          queueMicrotask(() =>
            void persistFileTreeExpandedPaths(workspaceID, snapshot)
          );
        }
        return next;
      });
    },
    [workspaceId]
  );

  const expansionValue = useMemo<ExpansionCtx>(
    () => ({ isPathExpanded, setPathExpanded }),
    [isPathExpanded, setPathExpanded]
  );
  const resolveDecoration = useMemo(
    () => createDecorationResolver(scmEntries),
    [scmEntries]
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setRefreshTick((tick) => tick + 1);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    void scmStatus(workspaceRoot)
      .then((list) => setScmEntries(list))
      .catch(() => setScmEntries([]));
  }, [workspaceRoot, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    if (refreshTick === 0) {
      setRootEntries(null);
      setRootError(null);
    }
    void invoke<DirEntry[]>("list_workspace_directory", {
      workspaceRoot,
      relativePath: "",
    })
      .then((list) => {
        if (!cancelled) {
          setRootEntries(list);
          setRootError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRootError(String(error));
          setRootEntries([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, refreshTick]);

  return (
    <div
      className="flex h-full min-w-0 flex-col border-l border-[var(--theme-border)] bg-[#151515] select-none"
    >
      {dragSession?.kind === "internal" ? (
        <TreeDragOverlay session={dragSession} />
      ) : null}

      {diffMenu &&
        createPortal(
          <div
            className="fixed z-[200] min-w-[200px] overflow-hidden rounded-md border border-[var(--theme-border)] bg-[var(--theme-panel-elevated)] py-1 text-xs shadow-lg"
            style={{
              left: Math.max(8, Math.min(diffMenu.x, window.innerWidth - 228)),
              top: Math.max(8, Math.min(diffMenu.y, window.innerHeight - 100)),
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[var(--theme-text)] hover:bg-[var(--theme-panel-hover)]"
              onClick={() => {
                layoutCommands.addDiffTabForPath(diffMenu.relPath, "staged");
                setDiffMenu(null);
              }}
            >
              Open diff (staged)
            </button>
          </div>,
          document.body
        )}

      <div className="flex shrink-0 gap-0 border-b border-[var(--theme-border)] p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 flex-1 rounded-md text-[11px] font-medium",
            leftMode === "files"
              ? "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]"
              : "text-[var(--theme-text-subtle)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
          )}
          onClick={() => setLeftMode("files")}
        >
          Files
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 flex-1 rounded-md text-[11px] font-medium",
            leftMode === "changes"
              ? "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]"
              : "text-[var(--theme-text-subtle)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
          )}
          onClick={() => setLeftMode("changes")}
        >
          Changes
        </Button>
      </div>

      {leftMode === "changes" ? (
        <WorkspaceChangesPanel workspaceRoot={workspaceRoot} workspaceId={workspaceId} />
      ) : (
        <FileTreeExpansionContext.Provider value={expansionValue}>
          <div
            ref={treeBodyRef}
            className="relative min-h-0 flex-1 overflow-auto py-1"
            onDragEnter={(event) => {
              if (pendingPointerDrag || dragSession?.kind === "internal") return;
              if (!isExternalFileDrag(event)) return;
              event.preventDefault();
              setExternalDragTarget(
                computeDropTargetFromPoint(event.clientX, event.clientY),
                { x: event.clientX, y: event.clientY }
              );
            }}
            onDragOver={(event) => {
              if (pendingPointerDrag || dragSession?.kind === "internal") return;
              if (!isExternalFileDrag(event)) return;
              event.preventDefault();
              setExternalDragTarget(
                computeDropTargetFromPoint(event.clientX, event.clientY),
                { x: event.clientX, y: event.clientY }
              );
            }}
            onDragLeave={(event) => {
              if (pendingPointerDrag || dragSession?.kind === "internal") return;
              if (!isExternalFileDrag(event)) return;
              if (isPointWithinTreeBody(event.clientX, event.clientY)) return;
              clearAllDragState();
            }}
            onDrop={(event) => {
              if (pendingPointerDrag || dragSession?.kind === "internal") return;
              if (!isExternalFileDrag(event)) return;
              event.preventDefault();
              externalTargetRef.current = computeDropTargetFromPoint(
                event.clientX,
                event.clientY
              );
              clearExternalDragVisualState();
            }}
          >
            {rootEntries === null ? (
              <div className="px-2 py-2 text-xs text-[var(--theme-text-subtle)]">Loading…</div>
            ) : null}
            {rootError ? (
              <div className="px-2 py-2 text-xs text-[var(--theme-error)]">{rootError}</div>
            ) : null}
            {rootEntries?.map((entry) =>
              entry.isDirectory ? (
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
                  onOpenDiffMenu={onOpenDiffMenu}
                  activePath={activePath}
                  refreshTick={refreshTick}
                  highlightedLeafDirectory={highlightedLeafDirectory}
                  targetDirectory={targetDirectory}
                  isHoverSuppressed={isHoverSuppressed}
                  onRowPointerDown={onRowPointerDown}
                  onRowClickCapture={onRowClickCapture}
                />
              ) : (
                <FileTreeRow
                  key={entry.name}
                  depth={0}
                  icon={<FileTypeIcon path={entry.name} kind="file" />}
                  label={entry.name}
                  decoration={resolveDecoration(entry.name, false, entry.isIgnored)}
                  fileRelPath={entry.name}
                  onOpenDiffMenu={onOpenDiffMenu}
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
              )
            )}
          </div>
        </FileTreeExpansionContext.Provider>
      )}
    </div>
  );
}
