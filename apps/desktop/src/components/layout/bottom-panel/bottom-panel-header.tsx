import { ChevronDown, Play, Plus, SplitSquareHorizontal } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/shared/utils";
import type { BottomTab } from "./bottom-panel.utils";

type BottomPanelHeaderProps = {
  tab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  onCollapse: () => void;
  onAddProjectTerminal: () => void;
  onSplitActiveGroup: () => void;
  hasTerminalGroups: boolean;
  onRunSetup?: () => void;
  onRunScripts?: () => void;
};

export function BottomPanelHeader({
  tab,
  onTabChange,
  onCollapse,
  onAddProjectTerminal,
  onSplitActiveGroup,
  hasTerminalGroups,
  onRunSetup,
  onRunScripts,
}: BottomPanelHeaderProps) {
  return (
    <div className="relative z-20 flex h-8 shrink-0 items-stretch border-b border-[var(--theme-border)] bg-[var(--theme-bg)]">
      <TabsList
        variant="underline"
        className="relative z-10 h-full rounded-none p-0 data-[variant=underline]:gap-0"
      >
        {(["setup", "run", "terminal", "ports"] as const).map((id) => {
          const labels: Record<BottomTab, string> = {
            setup: "Setup",
            run: "Run",
            terminal: "Project Terminals",
            ports: "Ports",
          };
          return (
            <TabsTrigger
              key={id}
              value={id}
              onClick={() => onTabChange(id)}
              className={cn(
                "relative z-10 h-full rounded-none px-3 text-xs after:z-20 after:h-[2px] group-data-horizontal/tabs:after:bottom-0",
                {
                  "bg-[var(--theme-bg)] text-[var(--theme-text)]": tab === id,
                  "text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]":
                    tab !== id,
                },
              )}
            >
              {labels[id]}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {tab === "setup" ? (
        <button
          type="button"
          title="Run setup scripts"
          onClick={onRunSetup}
          className="relative z-10 ml-auto flex h-full w-8 shrink-0 items-center justify-center text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {tab === "run" ? (
        <button
          type="button"
          title="Run scripts"
          onClick={onRunScripts}
          className="relative z-10 ml-auto flex h-full w-8 shrink-0 items-center justify-center text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {tab === "terminal" ? (
        <button
          type="button"
          title="New project terminal"
          onClick={onAddProjectTerminal}
          className="relative z-10 ml-auto flex h-full w-8 shrink-0 items-center justify-center text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : null}

      {tab === "terminal" ? (
        <button
          type="button"
          title="Split active terminal group"
          onClick={onSplitActiveGroup}
          disabled={!hasTerminalGroups}
          className="relative z-10 flex h-full w-8 shrink-0 items-center justify-center text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SplitSquareHorizontal className="h-3.5 w-3.5" />
        </button>
      ) : null}

      <button
        type="button"
        title="Collapse bottom panel"
        onClick={onCollapse}
        className="flex h-full w-8 shrink-0 items-center justify-center text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
