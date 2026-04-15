import { memo, useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Copy, FolderOpen, Code, Terminal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAvailableEditors, type EditorInfo } from "@/hooks/use-available-editors";

interface OpenInDropdownProps {
  worktreePath: string;
  workspaceName: string;
}

const ICON_MAP: Record<string, typeof FolderOpen> = {
  finder: FolderOpen,
  ide: Code,
  terminal: Terminal,
};

function appIcon(category: string, className = "size-3.5 shrink-0") {
  const Icon = ICON_MAP[category] ?? FolderOpen;
  return <Icon className={className} />;
}

const STORAGE_KEY = "pandora.openin.default";

export default memo(function OpenInDropdown({ worktreePath, workspaceName }: OpenInDropdownProps) {
  const { data: editors } = useAvailableEditors();
  const [menuOpen, setMenuOpen] = useState(false);
  const [defaultAppId, setDefaultAppId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "finder";
    } catch {
      return "finder";
    }
  });

  const grouped = useMemo(() => {
    if (!editors)
      return { finder: [] as EditorInfo[], ide: [] as EditorInfo[], terminal: [] as EditorInfo[] };
    return {
      finder: editors.filter((e) => e.category === "finder"),
      ide: editors.filter((e) => e.category === "ide"),
      terminal: editors.filter((e) => e.category === "terminal"),
    };
  }, [editors]);

  const allApps = useMemo(() => {
    return [...grouped.finder, ...grouped.ide, ...grouped.terminal];
  }, [grouped]);

  const defaultApp = useMemo(() => {
    return allApps.find((e) => e.id === defaultAppId) ?? allApps[0];
  }, [allApps, defaultAppId]);

  const handleOpen = useCallback(
    (appId: string) => {
      invoke("open_in_app", { path: worktreePath, appId }).catch(() => {});
      if (appId !== "copy_path") {
        setDefaultAppId(appId);
        try {
          localStorage.setItem(STORAGE_KEY, appId);
        } catch {}
      }
      setMenuOpen(false);
    },
    [worktreePath],
  );

  const shortLabel = useMemo(() => {
    const slug = worktreePath.split("/").pop() || workspaceName;
    return `/${slug}`;
  }, [worktreePath, workspaceName]);

  const handlePrimaryClick = useCallback(() => {
    if (defaultApp) handleOpen(defaultApp.id);
  }, [defaultApp, handleOpen]);

  // Keyboard handler: number keys select apps when menu is open
  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= allApps.length) {
        e.preventDefault();
        e.stopPropagation();
        handleOpen(allApps[num - 1].id);
      }
    },
    [allApps, handleOpen],
  );

  let index = 0;

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      {/* Trigger wraps the ENTIRE split button so the Positioner anchors to it */}
      <DropdownMenuTrigger
        render={
          <div className="flex items-center rounded-md border border-[var(--theme-border)] cursor-default" />
        }
      >
        {/* Left: main button — stopPropagation prevents dropdown open */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            handlePrimaryClick();
          }}
          className="flex items-center gap-1.5 rounded-l-md px-2 py-1 text-xs font-mono text-[var(--theme-text-subtle)] transition-colors hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
          title={`Open in ${defaultApp?.displayName ?? "Finder"}`}
        >
          {defaultApp ? appIcon(defaultApp.category) : <FolderOpen className="size-3.5 shrink-0" />}
          <span className="truncate max-w-32">{shortLabel}</span>
        </button>

        {/* Separator */}
        <div className="h-5 w-px bg-[var(--theme-border)]" />

        {/* Right: chevron — clicking here opens the dropdown (no stopPropagation) */}
        <div className="flex items-center rounded-r-md px-1.5 py-1 text-[var(--theme-text-subtle)] transition-colors hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]">
          <ChevronDown className="size-3.5" />
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="min-w-52"
        onKeyDown={handleMenuKeyDown}
      >
        {grouped.finder.map((editor) => {
          index += 1;
          const shortcut = index;
          return (
            <DropdownMenuItem key={editor.id} onClick={() => handleOpen(editor.id)}>
              {appIcon(editor.category, "size-4 shrink-0")}
              {editor.displayName}
              <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}

        {grouped.ide.length > 0 && grouped.finder.length > 0 && <DropdownMenuSeparator />}
        {grouped.ide.map((editor) => {
          index += 1;
          const shortcut = index;
          return (
            <DropdownMenuItem key={editor.id} onClick={() => handleOpen(editor.id)}>
              {appIcon(editor.category, "size-4 shrink-0")}
              {editor.displayName}
              <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}

        {grouped.terminal.length > 0 && (grouped.finder.length > 0 || grouped.ide.length > 0) && (
          <DropdownMenuSeparator />
        )}
        {grouped.terminal.map((editor) => {
          index += 1;
          const shortcut = index;
          return (
            <DropdownMenuItem key={editor.id} onClick={() => handleOpen(editor.id)}>
              {appIcon(editor.category, "size-4 shrink-0")}
              {editor.displayName}
              <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleOpen("copy_path")}>
          <Copy className="size-4 shrink-0" />
          Copy path
          <DropdownMenuShortcut>{"\u2318\u21E7C"}</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
