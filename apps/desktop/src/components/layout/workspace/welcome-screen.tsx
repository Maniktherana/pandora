import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, GitBranch, Zap } from "lucide-react";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";

// 5x7 dot-matrix pixel font for uppercase letters
const PIXEL_FONT: Record<string, number[][]> = {
  P: [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
    [1, 0, 0, 0, 0],
  ],
  A: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  N: [
    [1, 0, 0, 0, 1],
    [1, 1, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
  ],
  D: [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
  ],
  O: [
    [0, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ],
  R: [
    [1, 1, 1, 1, 0],
    [1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 0],
    [1, 0, 1, 0, 0],
    [1, 0, 0, 1, 0],
    [1, 0, 0, 0, 1],
  ],
};

const WORD = "PANDORA";
const LETTER_COLS = 5;
const LETTER_ROWS = 7;
const LETTER_GAP = 2; // columns of gap between letters

const DOT_COLORS = [
  "var(--theme-text)",
  "var(--theme-text-subtle)",
  "var(--theme-text-muted)",
];

function DotMatrixTitle() {
  // Build full grid: each letter is 5 cols wide, with LETTER_GAP columns between
  const totalCols = WORD.length * LETTER_COLS + (WORD.length - 1) * LETTER_GAP;

  const dots: { row: number; col: number; colorIdx: number; delay: number }[] = [];

  for (let li = 0; li < WORD.length; li++) {
    const letter = PIXEL_FONT[WORD[li]!];
    if (!letter) continue;
    const colOffset = li * (LETTER_COLS + LETTER_GAP);
    for (let r = 0; r < LETTER_ROWS; r++) {
      for (let c = 0; c < LETTER_COLS; c++) {
        if (letter[r]![c]) {
          // Color variation based on position
          const colorIdx = (r + c + li) % DOT_COLORS.length;
          // Stagger animation delay based on column position
          const delay = (colOffset + c) * 30 + r * 20;
          dots.push({ row: r, col: colOffset + c, colorIdx, delay });
        }
      }
    }
  }

  return (
    <div
      className="inline-grid"
      style={{
        gridTemplateColumns: `repeat(${totalCols}, 4px)`,
        gridTemplateRows: `repeat(${LETTER_ROWS}, 4px)`,
        gap: "2px",
      }}
    >
      {dots.map((dot, i) => (
        <div
          key={i}
          className="rounded-[1px] animate-[welcome-dot-shimmer_3s_ease-in-out_infinite]"
          style={{
            gridRow: dot.row + 1,
            gridColumn: dot.col + 1,
            backgroundColor: DOT_COLORS[dot.colorIdx],
            opacity: 0.85,
            animationDelay: `${dot.delay}ms`,
          }}
        />
      ))}
    </div>
  );
}

type ActionCardProps = {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
};

function ActionCard({ icon, label, onClick }: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      className="group flex w-40 flex-col justify-between rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_oklab,var(--theme-bg)_80%,transparent)] p-4 text-left transition-all hover:brightness-125 hover:border-[var(--theme-text-muted)]"
      style={{ minHeight: 100 }}
    >
      <div className="text-[var(--theme-text-subtle)] transition-colors group-hover:text-[var(--theme-text)]">
        {icon}
      </div>
      <span className="mt-3 text-sm font-medium text-[var(--theme-text-subtle)] transition-colors group-hover:text-[var(--theme-text)]">
        {label}
      </span>
    </button>
  );
}

export default function WelcomeScreen() {
  const workspaceCommands = useWorkspaceActions();

  const handleOpenProject = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Add Project - Choose a folder inside a Git repository",
    });
    if (selected) {
      workspaceCommands.addProject(selected);
    }
  }, [workspaceCommands]);

  const handleCloneUrl = useCallback(() => {
    // Placeholder for future implementation
    console.log("Clone from URL - coming soon");
  }, []);

  const handleQuickStart = useCallback(() => {
    // Placeholder for future implementation
    console.log("Quick Start - coming soon");
  }, []);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-10">
      <DotMatrixTitle />

      <div className="flex gap-4">
        <ActionCard
          icon={<FolderOpen className="h-5 w-5" />}
          label="Open Project"
          onClick={handleOpenProject}
        />
        <ActionCard
          icon={<GitBranch className="h-5 w-5" />}
          label="Clone from URL"
          onClick={handleCloneUrl}
        />
        <ActionCard
          icon={<Zap className="h-5 w-5" />}
          label="Quick Start"
          onClick={handleQuickStart}
        />
      </div>

      <p className="text-xs text-[var(--theme-text-faint)]">
        ctrl+shift+P to open command palette
      </p>
    </div>
  );
}
