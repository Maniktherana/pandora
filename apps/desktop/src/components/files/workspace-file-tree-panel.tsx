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
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight } from "lucide-react";
import WorkspaceChangesPanel from "@/components/scm/workspace-changes-panel";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/files/file-type-icon";
import { useLayoutCommands, useWorkspaceView } from "@/hooks/use-app-view";
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
import { useEditorStore } from "@/stores/editor-store";

type DirEntry = { name: string; isDirectory: boolean; isIgnored?: boolean };
type LeftPanelMode = "files" | "changes";
type ExpansionCtx = {
  isPathExpanded: (relPath: string) => boolean;
  setPathExpanded: (relPath: string, expanded: boolean) => void;
};
type ScmDecorationResolver = (
  relPath: string,
  isDirectory: boolean,
  isIgnored?: boolean
) => TreeScmDecoration;

const FileTreeExpansionContext = createContext<ExpansionCtx | null>(null);

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
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
  const visibleEntries = entries.filter((entry) => decorationForScmEntry(entry, { includeDeleted: false }).tone !== null);
  const exact = new Map(
    visibleEntries.map((entry) => [entry.path, decorationForScmEntry(entry, { includeDeleted: false })])
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
  fileRelPath,
  onOpenDiffMenu,
  active,
}: {
  depth: number;
  icon: React.ReactNode;
  label: string;
  decoration: TreeScmDecoration;
  className?: string;
  onOpen?: () => void;
  fileRelPath?: string;
  onOpenDiffMenu?: (clientX: number, clientY: number, relPath: string) => void;
  active?: boolean;
}) {
  const content = (
    <>
      {icon}
      <span className="truncate">{label}</span>
      {decoration.badge ? (
        <span className={cn("ml-auto shrink-0 font-mono text-[10px] font-semibold", scmToneTextClass(decoration.tone, false))}>
          {decoration.badge}
        </span>
      ) : null}
    </>
  );

  const rowClassName = cn(
    "flex min-w-0 w-full select-none items-center gap-1.5 rounded-sm py-0.5 pr-1 text-left text-xs hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]",
    scmToneTextClass(decoration.tone, decoration.dimmed),
    decoration.dimmed && "opacity-55",
    active && "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]",
    className
  );

  if (onOpen) {
    return (
      <button
        type="button"
        className={rowClassName}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={onOpen}
        onContextMenu={(e) => {
          if (!fileRelPath || !onOpenDiffMenu) return;
          e.preventDefault();
          onOpenDiffMenu(e.clientX, e.clientY, fileRelPath);
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={rowClassName} style={{ paddingLeft: 6 + depth * 12 }}>
      {content}
    </div>
  );
}

function DirectoryNode({
  workspaceRoot,
  workspaceId,
  relPath,
  name,
  depth,
  isIgnored,
  resolveDecoration,
  onOpenDiffMenu,
  activePath,
  refreshTick,
}: {
  workspaceRoot: string;
  workspaceId: string;
  relPath: string;
  name: string;
  depth: number;
  isIgnored?: boolean;
  resolveDecoration: ScmDecorationResolver;
  onOpenDiffMenu?: (clientX: number, clientY: number, fileRelPath: string) => void;
  activePath: string | null;
  refreshTick: number;
}) {
  const openFile = useEditorStore((s) => s.openFile);
  const { isPathExpanded, setPathExpanded } = useFileTreeExpansion();
  const open = isPathExpanded(relPath);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const decoration = resolveDecoration(relPath, true, isIgnored);

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
      .catch((e) => {
        if (!cancelled) {
          setLoadError(String(e));
          setChildren([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceRoot, relPath, refreshTick]);

  return (
    <Collapsible open={open} onOpenChange={(next) => setPathExpanded(relPath, next)}>
      <CollapsibleTrigger
        nativeButton={false}
        render={
            <Button
                variant="ghost"
                size="sm"
                className={cn(
              "group h-auto min-h-0 w-full select-none justify-start gap-1.5 rounded-sm py-0.5 pr-1 pl-0 font-normal hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]",
              scmToneTextClass(decoration.tone, decoration.dimmed),
              decoration.dimmed && "opacity-55"
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            <FileTypeIcon path={relPath} kind="directory" expanded={open} />
            <span className="truncate text-xs">{name}</span>
            {decoration.badge ? (
              <span className={cn("ml-auto shrink-0 font-mono text-[10px] font-semibold", scmToneTextClass(decoration.tone, false))}>
                {decoration.badge}
              </span>
            ) : null}
          </Button>
        }
      />
      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 pb-0.5">
          {loadError && (
            <div className="px-2 py-1 text-[11px] text-[var(--oc-error)]" style={{ paddingLeft: 18 + depth * 12 }}>
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
                name={entry.name}
                depth={depth + 1}
                isIgnored={entry.isIgnored}
                resolveDecoration={resolveDecoration}
                onOpenDiffMenu={onOpenDiffMenu}
                activePath={activePath}
                refreshTick={refreshTick}
              />
            ) : (
              <FileTreeRow
                key={joinRel(relPath, entry.name)}
                depth={depth + 1}
                icon={<FileTypeIcon path={joinRel(relPath, entry.name)} kind="file" />}
                label={entry.name}
                decoration={resolveDecoration(joinRel(relPath, entry.name), false, entry.isIgnored)}
                fileRelPath={joinRel(relPath, entry.name)}
                onOpenDiffMenu={onOpenDiffMenu}
                active={activePath === joinRel(relPath, entry.name)}
                onOpen={() => void openFile(workspaceId, workspaceRoot, joinRel(relPath, entry.name))}
              />
            )
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
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
  const [diffMenu, setDiffMenu] = useState<{ x: number; y: number; relPath: string } | null>(null);
  const [scmEntries, setScmEntries] = useState<ScmStatusEntry[]>([]);
  const openFile = useEditorStore((s) => s.openFile);
  const layoutCommands = useLayoutCommands();
  const runtime = useWorkspaceView(workspaceId, (view) => view.runtime);

  const activePath = useMemo(() => {
    if (!runtime?.root || !runtime.focusedPaneID) return null;
    const leaf = findLeaf(runtime.root, runtime.focusedPaneID);
    if (!leaf) return null;
    const tab = leaf.tabs[leaf.selectedIndex] ?? leaf.tabs[0];
    if (!tab || (tab.kind !== "editor" && tab.kind !== "diff")) return null;
    return tab.path;
  }, [runtime]);

  const onOpenDiffMenu = useCallback((clientX: number, clientY: number, relPath: string) => {
    setDiffMenu({ x: clientX, y: clientY, relPath });
  }, []);

  useEffect(() => {
    if (!diffMenu) return;
    const close = () => setDiffMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [diffMenu]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;
  const expansionLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    expansionLoadedRef.current = false;
    void loadFileTreeExpandedPaths(workspaceId)
      .then((paths) => {
        if (cancelled) return;
        let merged = new Set<string>();
        setExpandedPaths((current) => {
          merged = new Set<string>(paths);
          for (const p of current) merged.add(p);
          return merged;
        });
        expansionLoadedRef.current = true;
        const wid = workspaceId;
        const snap = new Set(merged);
        queueMicrotask(() => {
          if (!cancelled) void persistFileTreeExpandedPaths(wid, snap);
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
    const wid = workspaceId;
    return () => {
      if (!expansionLoadedRef.current) return;
      void persistFileTreeExpandedPaths(wid, expandedPathsRef.current);
    };
  }, [workspaceId]);

  const isPathExpanded = useCallback((relPath: string) => expandedPaths.has(relPath), [expandedPaths]);

  const setPathExpanded = useCallback(
    (relPath: string, expanded: boolean) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (expanded) next.add(relPath);
        else next.delete(relPath);
        if (expansionLoadedRef.current) {
          const wid = workspaceId;
          const snapshot = new Set(next);
          queueMicrotask(() => void persistFileTreeExpandedPaths(wid, snapshot));
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
  const resolveDecoration = useMemo(() => createDecorationResolver(scmEntries), [scmEntries]);

  // Tick counter that increments periodically to drive file tree + SCM refreshes.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    // Refresh immediately on mount, then poll every 3s when visible
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        setRefreshTick((t) => t + 1);
      }
    }, 3000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void scmStatus(workspaceRoot)
      .then((list) => setScmEntries(list))
      .catch(() => setScmEntries([]));
  }, [workspaceRoot, refreshTick]);

  useEffect(() => {
    let cancelled = false;
    if (refreshTick === 0) {
      // Only show loading spinner on first load, not on refreshes
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
      .catch((e) => {
        if (!cancelled) {
          setRootError(String(e));
          setRootEntries([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, refreshTick]);

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-[var(--oc-border)] bg-[#151515] select-none">
      {diffMenu &&
        createPortal(
          <div
            className="fixed z-[200] min-w-[200px] overflow-hidden rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel-elevated)] py-1 text-xs shadow-lg"
            style={{
              left: Math.max(8, Math.min(diffMenu.x, window.innerWidth - 228)),
              top: Math.max(8, Math.min(diffMenu.y, window.innerHeight - 100)),
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[var(--oc-text)] hover:bg-[var(--oc-panel-hover)]"
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

      <div className="flex shrink-0 gap-0 border-b border-[var(--oc-border)] p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 flex-1 rounded-md text-[11px] font-medium",
            leftMode === "files"
              ? "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]"
              : "text-[var(--oc-text-subtle)] hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]"
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
              ? "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]"
              : "text-[var(--oc-text-subtle)] hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]"
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
          <div className="min-h-0 flex-1 overflow-auto py-1">
            {rootEntries === null && <div className="px-2 py-2 text-xs text-[var(--oc-text-subtle)]">Loading…</div>}
            {rootError && <div className="px-2 py-2 text-xs text-[var(--oc-error)]">{rootError}</div>}
            {rootEntries?.map((entry) =>
              entry.isDirectory ? (
                <DirectoryNode
                  key={entry.name}
                  workspaceRoot={workspaceRoot}
                  workspaceId={workspaceId}
                  relPath={entry.name}
                  name={entry.name}
                  depth={0}
                  isIgnored={entry.isIgnored}
                  resolveDecoration={resolveDecoration}
                  onOpenDiffMenu={onOpenDiffMenu}
                  activePath={activePath}
                  refreshTick={refreshTick}
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
                />
              )
            )}
          </div>
        </FileTreeExpansionContext.Provider>
      )}
    </div>
  );
}
