import { invoke } from "@tauri-apps/api/core";
import type { TerminalThemeColors, WorkspaceTheme } from "@/lib/theme";
import { defaultTheme } from "@/lib/theme";

/**
 * Ghostty-format theme config (for UI chrome around the native terminal).
 * Uses the same key=value format as ~/.config/ghostty/config and Ghostty theme files.
 */

export interface GhosttyConfigSource {
  path: string | null;
  config: string | null;
}

export function buildGhosttyThemeConfig(theme: TerminalThemeColors): string {
  const paletteEntries = [
    theme.black,
    theme.red,
    theme.green,
    theme.yellow,
    theme.blue,
    theme.magenta,
    theme.cyan,
    theme.white,
    theme.brightBlack,
    theme.brightRed,
    theme.brightGreen,
    theme.brightYellow,
    theme.brightBlue,
    theme.brightMagenta,
    theme.brightCyan,
    theme.brightWhite,
  ];
  const lines = paletteEntries.flatMap((value, index) =>
    value ? [`palette = ${index}=${value}`] : [],
  );
  if (theme.background) lines.push(`background = ${theme.background}`);
  if (theme.foreground) lines.push(`foreground = ${theme.foreground}`);
  if (theme.cursor) lines.push(`cursor-color = ${theme.cursor}`);
  if (theme.cursorAccent) lines.push(`cursor-text = ${theme.cursorAccent}`);
  if (theme.selectionBackground) lines.push(`selection-background = ${theme.selectionBackground}`);
  if (theme.selectionForeground) lines.push(`selection-foreground = ${theme.selectionForeground}`);
  if (theme.typography?.fontFamily) lines.push(`font-family = ${theme.typography.fontFamily}`);
  if (theme.typography?.fontSize) lines.push(`font-size = ${theme.typography.fontSize}`);
  return `${lines.join("\n")}\n`;
}

const PALETTE_KEYS: Record<number, keyof TerminalThemeColors> = {
  0: "black",
  1: "red",
  2: "green",
  3: "yellow",
  4: "blue",
  5: "magenta",
  6: "cyan",
  7: "white",
  8: "brightBlack",
  9: "brightRed",
  10: "brightGreen",
  11: "brightYellow",
  12: "brightBlue",
  13: "brightMagenta",
  14: "brightCyan",
  15: "brightWhite",
};

export function parseGhosttyTheme(config: string): TerminalThemeColors {
  const theme: TerminalThemeColors = {};

  for (const raw of config.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();

    if (key === "palette") {
      const palEq = value.indexOf("=");
      if (palEq === -1) continue;
      const idx = parseInt(value.slice(0, palEq).trim(), 10);
      const color = value.slice(palEq + 1).trim();
      const themeKey = PALETTE_KEYS[idx];
      if (themeKey) {
        (theme as Record<string, string>)[themeKey] = color;
      }
    } else if (key === "background") {
      theme.background = value;
    } else if (key === "foreground") {
      theme.foreground = value;
    } else if (key === "cursor-color") {
      theme.cursor = value;
    } else if (key === "cursor-text") {
      theme.cursorAccent = value;
    } else if (key === "selection-background") {
      theme.selectionBackground = value;
    } else if (key === "selection-foreground") {
      theme.selectionForeground = value;
    } else if (key === "font-family") {
      theme.typography = { ...theme.typography, fontFamily: value };
    } else if (key === "font-size") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        theme.typography = { ...theme.typography, fontSize: parsed };
      }
    }
  }

  return theme;
}

/** Parsed Ghostty palette from a workspace pack’s `terminal.json` (for programmatic use). */
export function terminalThemeFromWorkspace(theme: WorkspaceTheme): TerminalThemeColors {
  return parseGhosttyTheme(buildGhosttyThemeConfig(theme.terminal));
}

/** Default workspace terminal colors (module load); prefer `var(--theme-terminal-bg)` in UI when possible. */
export const terminalTheme: TerminalThemeColors = terminalThemeFromWorkspace(defaultTheme);

export function readSystemGhosttyConfigSource(): Promise<GhosttyConfigSource> {
  return invoke<GhosttyConfigSource>("read_system_ghostty_config");
}

export async function readSystemGhosttyTheme(): Promise<TerminalThemeColors | null> {
  const source = await readSystemGhosttyConfigSource();
  if (!source.config) return null;
  return parseGhosttyTheme(source.config);
}
