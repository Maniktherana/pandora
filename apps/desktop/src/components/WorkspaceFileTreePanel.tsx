import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight } from "lucide-react";
import { FileTypeIcon } from "@/components/FileTypeIcon";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/stores/editor-store";
import { loadFileTreeExpandedPaths, persistFileTreeExpandedPaths } from "@/lib/ui-persistence";

type DirEntry = { name: string; isDirectory: boolean };

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
}: {
  depth: number;
  icon: React.ReactNode;
  label: string;
  className?: string;
  onOpen?: () => void;
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
}: {
  workspaceRoot: string;
  workspaceId: string;
  relPath: string;
  name: string;
  depth: number;
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
              />
            ) : (
              <FileTreeRow
                key={joinRel(relPath, entry.name)}
                depth={depth + 1}
                icon={
                  <FileTypeIcon path={joinRel(relPath, entry.name)} kind="file" />
                }
                label={entry.name}
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

const PERSIST_FILE_TREE_MS = 400;

export default function WorkspaceFileTreePanel({
  workspaceRoot,
  workspaceId,
}: {
  workspaceRoot: string;
  workspaceId: string;
}) {
  const [rootEntries, setRootEntries] = useState<DirEntry[] | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const openFile = useEditorStore((s) => s.openFile);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expandedSnapshotRef = useRef<Set<string>>(new Set());
  const expandedPathsRef = useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;

  useEffect(() => {
    let cancelled = false;
    setExpandedPaths(new Set());
    void loadFileTreeExpandedPaths(workspaceId).then((paths) => {
      if (!cancelled) setExpandedPaths(new Set(paths));
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    const wid = workspaceId;
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      void persistFileTreeExpandedPaths(wid, expandedPathsRef.current);
    };
  }, [workspaceId]);

  const schedulePersist = useCallback(
    (next: Set<string>) => {
      expandedSnapshotRef.current = next;
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        void persistFileTreeExpandedPaths(workspaceId, expandedSnapshotRef.current);
      }, PERSIST_FILE_TREE_MS);
    },
    [workspaceId]
  );

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  const isPathExpanded = useCallback((relPath: string) => expandedPaths.has(relPath), [expandedPaths]);

  const setPathExpanded = useCallback(
    (relPath: string, expanded: boolean) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (expanded) next.add(relPath);
        else next.delete(relPath);
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist]
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
    <FileTreeExpansionContext.Provider value={expansionValue}>
      <div className="flex h-full min-w-0 flex-col border-l border-neutral-800 bg-neutral-950/95">
        <div className="shrink-0 border-b border-neutral-800 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Files
        </div>
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
              />
            ) : (
              <FileTreeRow
                key={entry.name}
                depth={0}
                icon={<FileTypeIcon path={entry.name} kind="file" />}
                label={entry.name}
                onOpen={() => void openFile(workspaceId, workspaceRoot, entry.name)}
              />
            )
          )}
        </div>
      </div>
    </FileTreeExpansionContext.Provider>
  );
}
