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

const THEME_CONFIG = `
palette = 0=#929292
palette = 1=#e27373
palette = 2=#94b979
palette = 3=#ffba7b
palette = 4=#97bedc
palette = 5=#e1c0fa
palette = 6=#00988e
palette = 7=#dedede
palette = 8=#bdbdbd
palette = 9=#ffa1a1
palette = 10=#bddeab
palette = 11=#ffdca0
palette = 12=#b1d8f6
palette = 13=#fbdaff
palette = 14=#1ab2a8
palette = 15=#ffffff
background = #121212
foreground = #dedede
cursor-color = #ffa560
cursor-text = #ffffff
selection-background = #474e91
selection-foreground = #f4f4f4
`;

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

function parseGhosttyTheme(config: string): TerminalThemeColors {
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
