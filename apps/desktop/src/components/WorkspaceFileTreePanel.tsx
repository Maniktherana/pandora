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
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { loadFileTreeExpandedPaths, persistFileTreeExpandedPaths } from "@/lib/ui-persistence";
import WorkspaceChangesPanel from "@/components/WorkspaceChangesPanel";

type DirEntry = { name: string; isDirectory: boolean };

type LeftPanelMode = "files" | "changes";

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

type ExpansionCtx = {
  isPathExpanded: (relPath: string) => boolean;
  setPathExpanded: (relPath: string, expanded: boolean) => void;
};

const FileTreeExpansionContext = createContext<ExpansionCtx | null>(null);

function useFileTreeExpansion(): ExpansionCtx {
  const ctx = useContext(FileTreeExpansionContext);
  if (!ctx) {
    throw new Error("useFileTreeExpansion outside provider");
  }
  return ctx;
}

function FileTreeRow({
  depth,
  icon,
  label,
  className,
  onOpen,
  fileRelPath,
  onOpenDiffMenu,
}: {
  depth: number;
  icon: React.ReactNode;
  label: string;
  className?: string;
  onOpen?: () => void;
  /** When set with `onOpen`, right-click opens the diff menu at the pointer. */
  fileRelPath?: string;
  onOpenDiffMenu?: (clientX: number, clientY: number, relPath: string) => void;
}) {
  if (onOpen) {
    return (
      <button
        type="button"
        className={cn(
          "flex min-w-0 w-full items-center gap-1.5 rounded-sm py-0.5 pr-1 text-left text-xs text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
          className
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={onOpen}
        onContextMenu={(e) => {
          if (!fileRelPath || !onOpenDiffMenu) return;
          e.preventDefault();
          onOpenDiffMenu(e.clientX, e.clientY, fileRelPath);
        }}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
    );
  }
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 rounded-sm py-0.5 pr-1 text-xs text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200",
        className
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
    >
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function DirectoryNode({
  workspaceRoot,
  workspaceId,
  relPath,
  name,
  depth,
  onOpenDiffMenu,
}: {
  workspaceRoot: string;
  workspaceId: string;
  relPath: string;
  name: string;
  depth: number;
  onOpenDiffMenu?: (clientX: number, clientY: number, fileRelPath: string) => void;
}) {
  const openFile = useEditorStore((s) => s.openFile);
  const { isPathExpanded, setPathExpanded } = useFileTreeExpansion();
  const open = isPathExpanded(relPath);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || children !== null) return;
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
  }, [open, children, workspaceRoot, relPath]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setPathExpanded(relPath, next);
      }}
    >
      <CollapsibleTrigger
        nativeButton={false}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="group h-auto min-h-0 w-full justify-start gap-1.5 rounded-sm py-0.5 pr-1 pl-0 font-normal text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200 data-[panel-open]:bg-neutral-800/40"
            style={{ paddingLeft: 6 + depth * 12 }}
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            <FileTypeIcon path={relPath} kind="directory" expanded={open} />
            <span className="truncate text-xs">{name}</span>
          </Button>
        }
      />
      <CollapsibleContent>
        <div className="flex flex-col gap-0.5 pb-0.5">
          {loadError && (
            <div className="px-2 py-1 text-[11px] text-red-400/90" style={{ paddingLeft: 18 + depth * 12 }}>
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
                onOpenDiffMenu={onOpenDiffMenu}
              />
            ) : (
              <FileTreeRow
                key={joinRel(relPath, entry.name)}
                depth={depth + 1}
                icon={
                  <FileTypeIcon path={joinRel(relPath, entry.name)} kind="file" />
                }
                label={entry.name}
                fileRelPath={joinRel(relPath, entry.name)}
                onOpenDiffMenu={onOpenDiffMenu}
                onOpen={() =>
                  void openFile(workspaceId, workspaceRoot, joinRel(relPath, entry.name))
                }
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
  const [diffMenu, setDiffMenu] = useState<{
    x: number;
    y: number;
    relPath: string;
  } | null>(null);
  const openFile = useEditorStore((s) => s.openFile);
  const addDiffTabForPath = useWorkspaceStore((s) => s.addDiffTabForPath);

  const onOpenDiffMenu = useCallback(
    (clientX: number, clientY: number, relPath: string) => {
      setDiffMenu({ x: clientX, y: clientY, relPath });
    },
    []
  );

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

  useEffect(() => {
    let cancelled = false;
    setRootEntries(null);
    setRootError(null);
    void invoke<DirEntry[]>("list_workspace_directory", {
      workspaceRoot,
      relativePath: "",
    })
      .then((list) => {
        if (!cancelled) setRootEntries(list);
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
  }, [workspaceRoot]);

  return (
    <div className="flex h-full min-w-0 flex-col border-l border-neutral-800 bg-neutral-950/95">
      {diffMenu &&
        createPortal(
          <div
            className="fixed z-[200] min-w-[200px] overflow-hidden rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-lg"
            style={{
              left: Math.max(8, Math.min(diffMenu.x, window.innerWidth - 228)),
              top: Math.max(8, Math.min(diffMenu.y, window.innerHeight - 100)),
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
              onClick={() => {
                addDiffTabForPath(diffMenu.relPath, "working");
                setDiffMenu(null);
              }}
            >
              Open diff (working tree)
            </button>
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-neutral-200 hover:bg-neutral-800"
              onClick={() => {
                addDiffTabForPath(diffMenu.relPath, "staged");
                setDiffMenu(null);
              }}
            >
              Open diff (staged)
            </button>
          </div>,
          document.body
        )}
      <div className="flex shrink-0 gap-0 border-b border-neutral-800 p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 flex-1 rounded-md text-[11px] font-medium",
            leftMode === "files"
              ? "bg-neutral-800 text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200"
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
              ? "bg-neutral-800 text-neutral-100"
              : "text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200"
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
            {rootEntries === null && (
              <div className="px-2 py-2 text-xs text-neutral-500">Loading…</div>
            )}
            {rootError && (
              <div className="px-2 py-2 text-xs text-red-400/90">{rootError}</div>
            )}
            {rootEntries?.map((entry) =>
              entry.isDirectory ? (
                <DirectoryNode
                  key={entry.name}
                  workspaceRoot={workspaceRoot}
                  workspaceId={workspaceId}
                  relPath={entry.name}
                  name={entry.name}
                  depth={0}
                  onOpenDiffMenu={onOpenDiffMenu}
                />
              ) : (
                <FileTreeRow
                  key={entry.name}
                  depth={0}
                  icon={<FileTypeIcon path={entry.name} kind="file" />}
                  label={entry.name}
                  fileRelPath={entry.name}
                  onOpenDiffMenu={onOpenDiffMenu}
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
