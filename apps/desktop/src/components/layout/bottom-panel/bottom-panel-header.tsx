import { ChevronDown, Plus, SplitSquareHorizontal } from "lucide-react";
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
};

export function BottomPanelHeader({
  tab,
  onTabChange,
  onCollapse,
  onAddProjectTerminal,
  onSplitActiveGroup,
  hasTerminalGroups,
}: BottomPanelHeaderProps) {
  return (
    <div className="flex h-8 shrink-0 items-stretch border-t border-neutral-800">
      <button
        type="button"
        title="Collapse bottom panel"
        onClick={onCollapse}
        className="flex h-full w-8 shrink-0 items-center justify-center text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      <TabsList
        variant="line"
        className="h-full rounded-none p-0 data-[variant=line]:gap-0"
      >
        {(["terminal", "ports"] as const).map((id) => (
          <TabsTrigger
            key={id}
            value={id}
            onClick={() => onTabChange(id)}
            className={cn(
              "h-full rounded-none px-3 text-xs after:bottom-[-1px] after:h-[2px]",
              tab === id
                ? "bg-neutral-900 text-neutral-100"
                : "text-neutral-500 hover:bg-neutral-800/30 hover:text-neutral-300"
            )}
          >
            {id === "terminal" ? "Terminal" : "Ports"}
          </TabsTrigger>
        ))}
      </TabsList>

      {tab === "terminal" ? (
        <button
          type="button"
          title="New project terminal"
          onClick={onAddProjectTerminal}
          className="ml-auto flex h-full w-8 shrink-0 items-center justify-center text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
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
          className="flex h-full w-8 shrink-0 items-center justify-center text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SplitSquareHorizontal className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
