import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BranchPrefixMode = "github-username" | "custom" | "none";
export type FontOption =
  | "system-default"
  | "segoe-ui"
  | "sf-pro"
  | "helvetica"
  | "inter"
  | "custom";
export type MonoFontOption =
  | "jetbrains-mono"
  | "fira-code"
  | "inconsolata"
  | "source-code-pro"
  | "custom";
export type TerminalFontOption =
  | "jetbrains-nerd"
  | "fira-code-nerd"
  | "menlo"
  | "monaco"
  | "custom";

export interface SettingsStore {
  // Appearance
  selectedThemeId: string;
  uiFontFamily: FontOption;
  uiFontCustom: string;
  monoFontFamily: MonoFontOption;
  monoFontCustom: string;
  terminalFontFamily: TerminalFontOption;
  terminalFontCustom: string;
  editorFontSize: number;
  terminalFontSize: number;

  // Workspaces
  archiveDeletesWorktree: boolean;

  // Git
  branchPrefixMode: BranchPrefixMode;
  branchPrefixCustom: string;
  deleteLocalBranchOnArchive: boolean;
  archiveOnMerge: boolean;

  // Actions
  setTheme: (themeId: string) => void;
  setUiFont: (fontFamily: FontOption, custom?: string) => void;
  setMonoFont: (fontFamily: MonoFontOption, custom?: string) => void;
  setTerminalFont: (fontFamily: TerminalFontOption, custom?: string) => void;
  setEditorFontSize: (size: number) => void;
  setTerminalFontSize: (size: number) => void;
  increaseEditorFontSize: () => void;
  decreaseEditorFontSize: () => void;
  increaseTerminalFontSize: () => void;
  decreaseTerminalFontSize: () => void;
  setArchiveDeletesWorktree: (value: boolean) => void;
  setBranchPrefixMode: (mode: BranchPrefixMode, custom?: string) => void;
  setDeleteLocalBranchOnArchive: (value: boolean) => void;
  setArchiveOnMerge: (value: boolean) => void;
}

const STORAGE_KEY = "pandora-settings";
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

function clampFontSize(size: number) {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
}

const FONT_FAMILY_MAP: Record<FontOption, string> = {
  "system-default": "system-ui, -apple-system, sans-serif",
  "segoe-ui": "Segoe UI, system-ui, sans-serif",
  "sf-pro": "SF Pro Display, system-ui, sans-serif",
  helvetica: "Helvetica Neue, sans-serif",
  inter: "Inter, sans-serif",
  custom: "inherit",
};

const MONO_FONT_MAP: Record<MonoFontOption, string> = {
  "jetbrains-mono": "JetBrains Mono, monospace",
  "fira-code": "Fira Code, monospace",
  inconsolata: "Inconsolata, monospace",
  "source-code-pro": "Source Code Pro, monospace",
  custom: "inherit",
};

const TERMINAL_FONT_MAP: Record<TerminalFontOption, string> = {
  "jetbrains-nerd": "JetBrains Mono, Nerd Font, monospace",
  "fira-code-nerd": "Fira Code, Nerd Font, monospace",
  menlo: "Menlo, Monaco, monospace",
  monaco: "Monaco, monospace",
  custom: "inherit",
};

export function getFontFamily(font: FontOption, custom: string): string {
  return font === "custom" && custom ? custom : FONT_FAMILY_MAP[font];
}

export function getMonoFont(font: MonoFontOption, custom: string): string {
  return font === "custom" && custom ? custom : MONO_FONT_MAP[font];
}

export function getTerminalFont(font: TerminalFontOption, custom: string): string {
  return font === "custom" && custom ? custom : TERMINAL_FONT_MAP[font];
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      selectedThemeId: "oc-2",
      uiFontFamily: "system-default",
      uiFontCustom: "",
      monoFontFamily: "jetbrains-mono",
      monoFontCustom: "",
      terminalFontFamily: "jetbrains-nerd",
      terminalFontCustom: "",
      editorFontSize: 13,
      terminalFontSize: 13,
      archiveDeletesWorktree: false,
      branchPrefixMode: "github-username",
      branchPrefixCustom: "",
      deleteLocalBranchOnArchive: false,
      archiveOnMerge: false,

      setTheme: (themeId: string) => set({ selectedThemeId: themeId }),
      setUiFont: (fontFamily: FontOption, custom: string = "") =>
        set({ uiFontFamily: fontFamily, uiFontCustom: custom }),
      setMonoFont: (fontFamily: MonoFontOption, custom: string = "") =>
        set({ monoFontFamily: fontFamily, monoFontCustom: custom }),
      setTerminalFont: (fontFamily: TerminalFontOption, custom: string = "") =>
        set({ terminalFontFamily: fontFamily, terminalFontCustom: custom }),
      setEditorFontSize: (size: number) => set({ editorFontSize: clampFontSize(size) }),
      setTerminalFontSize: (size: number) => set({ terminalFontSize: clampFontSize(size) }),
      increaseEditorFontSize: () =>
        set((state) => ({ editorFontSize: clampFontSize(state.editorFontSize + 1) })),
      decreaseEditorFontSize: () =>
        set((state) => ({ editorFontSize: clampFontSize(state.editorFontSize - 1) })),
      increaseTerminalFontSize: () =>
        set((state) => ({ terminalFontSize: clampFontSize(state.terminalFontSize + 1) })),
      decreaseTerminalFontSize: () =>
        set((state) => ({ terminalFontSize: clampFontSize(state.terminalFontSize - 1) })),
      setArchiveDeletesWorktree: (value: boolean) => set({ archiveDeletesWorktree: value }),
      setBranchPrefixMode: (mode: BranchPrefixMode, custom: string = "") =>
        set({ branchPrefixMode: mode, branchPrefixCustom: custom }),
      setDeleteLocalBranchOnArchive: (value: boolean) => set({ deleteLocalBranchOnArchive: value }),
      setArchiveOnMerge: (value: boolean) => set({ archiveOnMerge: value }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      migrate: (persisted) => persisted as SettingsStore,
    },
  ),
);
