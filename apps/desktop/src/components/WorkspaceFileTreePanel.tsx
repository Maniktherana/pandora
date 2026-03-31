import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, File, Folder } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DirEntry = { name: string; isDirectory: boolean };

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function FileTreeRow({
  depth,
  icon,
  label,
  className,
}: {
  depth: number;
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
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
  relPath,
  name,
  depth,
}: {
  workspaceRoot: string;
  relPath: string;
  name: string;
  depth: number;
}) {
  const [open, setOpen] = useState(false);
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
    <Collapsible open={open} onOpenChange={setOpen}>
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
            <Folder className="size-3.5 shrink-0 text-amber-600/90" />
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
                relPath={joinRel(relPath, entry.name)}
                name={entry.name}
                depth={depth + 1}
              />
            ) : (
              <FileTreeRow
                key={joinRel(relPath, entry.name)}
                depth={depth + 1}
                icon={<File className="size-3.5 shrink-0 text-neutral-500" />}
                label={entry.name}
              />
            )
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function WorkspaceFileTreePanel({ workspaceRoot }: { workspaceRoot: string }) {
  const [rootEntries, setRootEntries] = useState<DirEntry[] | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);

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
              relPath={entry.name}
              name={entry.name}
              depth={0}
            />
          ) : (
            <FileTreeRow
              key={entry.name}
              depth={0}
              icon={<File className="size-3.5 shrink-0 text-neutral-500" />}
              label={entry.name}
            />
          )
        )}
      </div>
    </div>
  );
}
