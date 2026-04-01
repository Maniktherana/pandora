import { invoke } from "@tauri-apps/api/core";
import { oc2Theme } from "@/lib/theme/oc2";

/**
 * Ghostty-format theme config (for UI chrome around the native terminal).
 * Uses the same key=value format as ~/.config/ghostty/config and Ghostty theme files.
 */

export interface TerminalThemeColors {
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
}

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
  const lines = paletteEntries.flatMap((value, index) => (value ? [`palette = ${index}=${value}`] : []));
  if (theme.background) lines.push(`background = ${theme.background}`);
  if (theme.foreground) lines.push(`foreground = ${theme.foreground}`);
  if (theme.cursor) lines.push(`cursor-color = ${theme.cursor}`);
  if (theme.cursorAccent) lines.push(`cursor-text = ${theme.cursorAccent}`);
  if (theme.selectionBackground) lines.push(`selection-background = ${theme.selectionBackground}`);
  if (theme.selectionForeground) lines.push(`selection-foreground = ${theme.selectionForeground}`);
  return `${lines.join("\n")}\n`;
}

const THEME_CONFIG = buildGhosttyThemeConfig({
  black: "#505050",
  red: oc2Theme.colors.error,
  green: oc2Theme.colors.success,
  yellow: oc2Theme.colors.warning,
  blue: oc2Theme.colors.syntaxPrimitive,
  magenta: oc2Theme.colors.info,
  cyan: oc2Theme.colors.syntaxString,
  white: oc2Theme.colors.text,
  brightBlack: oc2Theme.colors.textSubtle,
  brightRed: "#FF8A7A",
  brightGreen: oc2Theme.colors.diffAdd,
  brightYellow: "#FFE98A",
  brightBlue: "#B6CBFF",
  brightMagenta: "#F8D1FB",
  brightCyan: "#93E9F6",
  brightWhite: "#FFFFFF",
  background: "#151515",
  foreground: oc2Theme.colors.text,
  cursor: oc2Theme.colors.primary,
  cursorAccent: "#171311",
  selectionBackground: oc2Theme.colors.selection,
  selectionForeground: oc2Theme.colors.text,
});

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
    }
  }

  return theme;
}

export const terminalTheme: TerminalThemeColors = parseGhosttyTheme(THEME_CONFIG);

export function readSystemGhosttyConfigSource(): Promise<GhosttyConfigSource> {
  return invoke<GhosttyConfigSource>("read_system_ghostty_config");
}

export async function readSystemGhosttyTheme(): Promise<TerminalThemeColors | null> {
  const source = await readSystemGhosttyConfigSource();
  if (!source.config) return null;
  return parseGhosttyTheme(source.config);
}
