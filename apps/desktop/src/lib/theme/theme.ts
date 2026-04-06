import type { CSSProperties } from "react";
import type { editor } from "monaco-editor";

export type ThemeMode = "light" | "dark";

export type CodeEditorTheme = {
  typography: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
  };
  surface: {
    base: string;
    chrome: string;
    hover: string;
    separator: string;
  };
  text: {
    primary: string;
    muted: string;
    subtle: string;
    faint: string;
    lineNumber: string;
  };
  accent: {
    selection: string;
    selectionInactive: string;
  };
  diff: {
    add: {
      base: string;
      fill: string;
      fillStrong: string;
    };
    delete: {
      base: string;
      fill: string;
      fillStrong: string;
    };
    modified: {
      base: string;
      fill: string;
    };
  };
  gutter: {
    bar: {
      add: string;
      delete: string;
      modified: string;
    };
  };
  syntax: {
    comment: string;
    keyword: string;
    string: string;
    primitive: string;
    property: string;
    type: string;
    constant: string;
    operator: string;
    punctuation: string;
    variable: string;
  };
  cursor: string;
  scrollbar: string;
  scrollbarHover: string;
};

export type ReactUiTheme = {
  typography: {
    sans: string;
    mono: string;
  };
  background: string;
  panel: string;
  panelElevated: string;
  panelHover: string;
  panelInteractive: string;
  border: string;
  borderSubtle: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  textFaint: string;
  primary: string;
  success: string;
  successBg: string;
  warning: string;
  error: string;
  errorBg: string;
  info: string;
  interactive: string;
  diffAdd: string;
  diffDelete: string;
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxString: string;
  syntaxPrimitive: string;
  syntaxProperty: string;
  syntaxType: string;
  syntaxConstant: string;
  cursor: string;
  selection: string;
  selectionInactive: string;
  currentLine: string;
  scrollbar: string;
  scrollbarHover: string;
};

export type TerminalThemeColors = {
  typography?: {
    fontFamily?: string;
    fontSize?: number;
  };
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
};

export type WorkspaceTheme = {
  id: string;
  name: string;
  mode: ThemeMode;
  ui: ReactUiTheme;
  codeEditor: CodeEditorTheme;
  terminal: TerminalThemeColors;
};

export function getThemeCssVariables(theme: WorkspaceTheme): Record<string, string> {
  const ui = theme.ui;
  const tokens = theme.codeEditor;
  return {
    "--theme-font-sans": ui.typography.sans,
    "--theme-font-mono": ui.typography.mono,
    "--theme-font-editor": tokens.typography.fontFamily,
    "--theme-font-editor-size": `${tokens.typography.fontSize}px`,
    "--theme-font-editor-line-height": `${tokens.typography.lineHeight}px`,
    "--theme-font-terminal":
      theme.terminal.typography?.fontFamily ?? tokens.typography.fontFamily,
    "--theme-font-terminal-size": theme.terminal.typography?.fontSize
      ? `${theme.terminal.typography.fontSize}px`
      : `${tokens.typography.fontSize}px`,
    "--theme-bg": ui.background,
    "--theme-panel": ui.panel,
    "--theme-panel-elevated": ui.panelElevated,
    "--theme-panel-hover": ui.panelHover,
    "--theme-panel-interactive": ui.panelInteractive,
    "--theme-border": ui.border,
    "--theme-border-subtle": ui.borderSubtle,
    "--theme-text": ui.text,
    "--theme-text-muted": ui.textMuted,
    "--theme-text-subtle": ui.textSubtle,
    "--theme-text-faint": ui.textFaint,
    "--theme-primary": ui.primary,
    "--theme-success": ui.success,
    "--theme-success-bg": ui.successBg,
    "--theme-warning": ui.warning,
    "--theme-error": ui.error,
    "--theme-error-bg": ui.errorBg,
    "--theme-info": ui.info,
    "--theme-interactive": ui.interactive,
    "--theme-diff-add": ui.diffAdd,
    "--theme-diff-delete": ui.diffDelete,
    "--theme-selection": ui.selection,
    "--theme-selection-inactive": ui.selectionInactive,
    "--theme-scrollbar": ui.scrollbar,
    "--theme-scrollbar-hover": ui.scrollbarHover,
    "--theme-code-surface-base": tokens.surface.base,
    "--theme-code-surface-chrome": tokens.surface.chrome,
    "--theme-code-surface-hover": tokens.surface.hover,
    "--theme-code-surface-separator": tokens.surface.separator,
    "--theme-code-text-primary": tokens.text.primary,
    "--theme-code-text-muted": tokens.text.muted,
    "--theme-code-text-line-number": tokens.text.lineNumber,
    "--theme-code-selection": tokens.accent.selection,
    "--theme-code-selection-inactive": tokens.accent.selectionInactive,
    "--theme-code-diff-add-base": tokens.diff.add.base,
    "--theme-code-diff-add-fill": tokens.diff.add.fill,
    "--theme-code-diff-add-fill-strong": tokens.diff.add.fillStrong,
    "--theme-code-diff-delete-base": tokens.diff.delete.base,
    "--theme-code-diff-delete-fill": tokens.diff.delete.fill,
    "--theme-code-diff-delete-fill-strong": tokens.diff.delete.fillStrong,
    "--theme-code-diff-modified-base": tokens.diff.modified.base,
    "--theme-code-diff-modified-fill": tokens.diff.modified.fill,
    "--theme-code-gutter-add": tokens.gutter.bar.add,
    "--theme-code-gutter-delete": tokens.gutter.bar.delete,
    "--theme-code-gutter-modified": tokens.gutter.bar.modified,
    "--theme-syntax-comment": tokens.syntax.comment,
    "--theme-syntax-keyword": tokens.syntax.keyword,
    "--theme-syntax-string": tokens.syntax.string,
    "--theme-syntax-primitive": tokens.syntax.primitive,
    "--theme-syntax-property": tokens.syntax.property,
    "--theme-syntax-type": tokens.syntax.type,
    "--theme-syntax-constant": tokens.syntax.constant,
    "--theme-syntax-operator": tokens.syntax.operator,
    "--theme-syntax-punctuation": tokens.syntax.punctuation,
    "--theme-syntax-variable": tokens.syntax.variable,
  };
}

export function applyTheme(theme: WorkspaceTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme.mode === "dark");
  root.classList.toggle("light", theme.mode === "light");
  root.dataset.theme = theme.id;
  root.dataset.colorScheme = theme.mode;
  for (const [key, value] of Object.entries(getThemeCssVariables(theme))) {
    root.style.setProperty(key, value);
  }
}

export function toPierreVariables(tokens: CodeEditorTheme): CSSProperties {
  return {
    "--diffs-bg": tokens.surface.base,
    "--diffs-bg-buffer": tokens.surface.base,
    "--diffs-bg-hover": tokens.surface.hover,
    "--diffs-bg-context": tokens.surface.base,
    "--diffs-bg-separator": tokens.surface.chrome,
    "--diffs-fg": tokens.text.primary,
    "--diffs-fg-number": tokens.text.lineNumber,
    "--diffs-fg-number-addition-override": tokens.diff.add.base,
    "--diffs-fg-number-deletion-override": tokens.diff.delete.base,
    "--diffs-deletion-base": tokens.diff.delete.base,
    "--diffs-addition-base": tokens.diff.add.base,
    "--diffs-modified-base": tokens.diff.modified.base,
    "--diffs-bg-deletion": tokens.diff.delete.fill,
    "--diffs-bg-deletion-number": tokens.surface.base,
    "--diffs-bg-deletion-emphasis": tokens.diff.delete.fillStrong,
    "--diffs-bg-addition": tokens.diff.add.fill,
    "--diffs-bg-addition-number": tokens.surface.base,
    "--diffs-bg-addition-emphasis": tokens.diff.add.fillStrong,
    "--diffs-font-family": tokens.typography.fontFamily,
    "--diffs-font-size": `${tokens.typography.fontSize}px`,
    "--diffs-line-height": `${tokens.typography.lineHeight}px`,
    "--diffs-tab-size": "2",
    "--diffs-gap-block": "0",
    "--diffs-min-number-column-width": "4ch",
    "--theme-font-editor": tokens.typography.fontFamily,
    "--theme-font-editor-size": `${tokens.typography.fontSize}px`,
    "--theme-font-editor-line-height": `${tokens.typography.lineHeight}px`,
    "--theme-code-surface-base": tokens.surface.base,
    "--theme-code-surface-chrome": tokens.surface.chrome,
    "--theme-code-surface-hover": tokens.surface.hover,
    "--theme-code-surface-separator": tokens.surface.separator,
    "--theme-code-text-primary": tokens.text.primary,
    "--theme-code-text-muted": tokens.text.muted,
    "--theme-code-text-line-number": tokens.text.lineNumber,
    "--theme-code-selection": tokens.accent.selection,
    "--theme-code-selection-inactive": tokens.accent.selectionInactive,
    "--theme-code-diff-add-base": tokens.diff.add.base,
    "--theme-code-diff-add-fill": tokens.diff.add.fill,
    "--theme-code-diff-add-fill-strong": tokens.diff.add.fillStrong,
    "--theme-code-diff-delete-base": tokens.diff.delete.base,
    "--theme-code-diff-delete-fill": tokens.diff.delete.fill,
    "--theme-code-diff-delete-fill-strong": tokens.diff.delete.fillStrong,
    "--theme-code-diff-modified-base": tokens.diff.modified.base,
    "--theme-code-diff-modified-fill": tokens.diff.modified.fill,
    "--theme-code-gutter-add": tokens.gutter.bar.add,
    "--theme-code-gutter-delete": tokens.gutter.bar.delete,
    "--theme-code-gutter-modified": tokens.gutter.bar.modified,
    "--theme-syntax-comment": tokens.syntax.comment,
    "--theme-syntax-keyword": tokens.syntax.keyword,
    "--theme-syntax-string": tokens.syntax.string,
    "--theme-syntax-primitive": tokens.syntax.primitive,
    "--theme-syntax-property": tokens.syntax.property,
    "--theme-syntax-type": tokens.syntax.type,
    "--theme-syntax-constant": tokens.syntax.constant,
    "--theme-syntax-operator": tokens.syntax.operator,
    "--theme-syntax-punctuation": tokens.syntax.punctuation,
    "--theme-syntax-variable": tokens.syntax.variable,
  } as CSSProperties;
}

export function toMonacoTheme(theme: WorkspaceTheme): editor.IStandaloneThemeData {
  const tokens = theme.codeEditor;
  return {
    base: theme.mode === "dark" ? "vs-dark" : "vs",
    inherit: false,
    semanticHighlighting: false,
    rules: [
      { token: "", foreground: tokens.text.primary.slice(1), background: tokens.surface.base.slice(1) },
      { token: "comment", foreground: tokens.syntax.comment.slice(1) },
      { token: "comment.doc", foreground: tokens.syntax.comment.slice(1) },
      { token: "keyword", foreground: tokens.syntax.keyword.slice(1) },
      { token: "keyword.json", foreground: tokens.syntax.keyword.slice(1) },
      { token: "string", foreground: tokens.syntax.string.slice(1) },
      { token: "string.key", foreground: tokens.syntax.property.slice(1) },
      { token: "string.key.json", foreground: tokens.syntax.property.slice(1) },
      { token: "number", foreground: tokens.syntax.primitive.slice(1) },
      { token: "number.json", foreground: tokens.syntax.primitive.slice(1) },
      { token: "regexp", foreground: tokens.syntax.string.slice(1) },
      { token: "constant", foreground: tokens.syntax.constant.slice(1) },
      { token: "constant.language", foreground: tokens.syntax.constant.slice(1) },
      { token: "type", foreground: tokens.syntax.type.slice(1) },
      { token: "type.identifier", foreground: tokens.syntax.type.slice(1) },
      { token: "type.defaultLibrary", foreground: tokens.syntax.primitive.slice(1) },
      { token: "tag", foreground: tokens.syntax.keyword.slice(1) },
      { token: "tag.id", foreground: tokens.syntax.type.slice(1) },
      { token: "tag.class", foreground: tokens.syntax.type.slice(1) },
      { token: "attribute.name", foreground: tokens.syntax.property.slice(1) },
      { token: "attribute.value", foreground: tokens.syntax.string.slice(1) },
      { token: "property", foreground: tokens.syntax.property.slice(1) },
      { token: "property.name", foreground: tokens.syntax.property.slice(1) },
      { token: "variable", foreground: tokens.syntax.variable.slice(1) },
      { token: "variable.parameter", foreground: tokens.syntax.constant.slice(1) },
      { token: "variable.property", foreground: tokens.syntax.property.slice(1) },
      { token: "variable.object.property", foreground: tokens.syntax.property.slice(1) },
      { token: "identifier", foreground: tokens.syntax.variable.slice(1) },
      { token: "identifier.json", foreground: tokens.syntax.property.slice(1) },
      { token: "delimiter", foreground: tokens.syntax.punctuation.slice(1) },
      { token: "delimiter.bracket", foreground: tokens.syntax.punctuation.slice(1) },
      { token: "delimiter.array", foreground: tokens.syntax.punctuation.slice(1) },
      { token: "delimiter.object", foreground: tokens.syntax.punctuation.slice(1) },
      { token: "operator", foreground: tokens.syntax.operator.slice(1) },
      { token: "operator.json", foreground: tokens.syntax.punctuation.slice(1) },
      { token: "metatag", foreground: tokens.syntax.keyword.slice(1) },
      { token: "metatag.content", foreground: tokens.syntax.string.slice(1) },
      { token: "metatag.attribute", foreground: tokens.syntax.property.slice(1) },
      { token: "invalid", foreground: tokens.diff.delete.base.slice(1) },
    ],
    colors: {
      "editor.background": tokens.surface.base,
      "editor.foreground": tokens.text.primary,
      "editorCursor.foreground": tokens.cursor,
      "editor.lineHighlightBackground": tokens.surface.hover,
      "editorLineNumber.foreground": tokens.text.lineNumber,
      "editorLineNumber.activeForeground": tokens.text.muted,
      "editor.selectionBackground": tokens.accent.selection,
      "editor.inactiveSelectionBackground": tokens.accent.selectionInactive,
      "editor.selectionHighlightBackground": "#034CFF33",
      "editor.findMatchBackground": "#FCD53A44",
      "editor.findMatchHighlightBackground": "#FCD53A22",
      "editor.wordHighlightBackground": "#FAB2831E",
      "editor.wordHighlightStrongBackground": "#FAB28330",
      "editorIndentGuide.background1": tokens.surface.separator,
      "editorIndentGuide.activeBackground1": tokens.text.subtle,
      "editorWhitespace.foreground": "#50505088",
      "editorGutter.background": tokens.surface.base,
      "editorGutter.addedBackground": tokens.gutter.bar.add,
      "editorGutter.modifiedBackground": tokens.gutter.bar.modified,
      "editorGutter.deletedBackground": tokens.gutter.bar.delete,
      "editorWidget.background": theme.ui.panelElevated,
      "editorWidget.border": tokens.surface.separator,
      "editorOverviewRuler.border": "#00000000",
      "editorOverviewRuler.addedForeground": "#B8DB8799",
      "editorOverviewRuler.modifiedForeground": "#F5A74299",
      "editorOverviewRuler.deletedForeground": "#E26A7599",
      "minimap.background": tokens.surface.base,
      "minimap.selectionHighlight": "#034CFF44",
      "minimap.findMatchHighlight": "#FCD53A44",
      "minimap.errorHighlight": "#FC533A66",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#50505055",
      "scrollbarSlider.hoverBackground": "#70707088",
      "scrollbarSlider.activeBackground": "#A0A0A088",
      "diffEditor.insertedTextBackground": tokens.diff.add.fillStrong,
      "diffEditor.removedTextBackground": tokens.diff.delete.fillStrong,
      "diffEditor.insertedLineBackground": tokens.diff.add.fill,
      "diffEditor.removedLineBackground": tokens.diff.delete.fill,
      "diffEditor.diagonalFill": tokens.surface.chrome,
      "diffEditorGutter.insertedLineBackground": tokens.gutter.bar.add,
      "diffEditorGutter.removedLineBackground": tokens.gutter.bar.delete,
      "diffEditorOverview.insertedForeground": "#B8DB8788",
      "diffEditorOverview.removedForeground": "#E26A7588",
      "list.activeSelectionBackground": tokens.accent.selection,
      "list.activeSelectionForeground": tokens.text.primary,
      "list.hoverBackground": theme.ui.panelHover,
      "list.hoverForeground": tokens.text.primary,
      "list.inactiveSelectionBackground": tokens.surface.hover,
      "list.inactiveSelectionForeground": tokens.text.muted,
      "input.background": tokens.surface.chrome,
      "input.foreground": tokens.text.primary,
      "input.border": tokens.surface.separator,
      "inputOption.activeBorder": theme.ui.interactive,
      "inputOption.activeBackground": "#034CFF22",
      "dropdown.background": theme.ui.panelElevated,
      "dropdown.foreground": tokens.text.primary,
      "dropdown.border": tokens.surface.separator,
      "menu.background": theme.ui.panelElevated,
      "menu.foreground": tokens.text.primary,
      "menu.selectionBackground": theme.ui.panelHover,
      "menu.selectionForeground": tokens.text.primary,
      "menu.border": tokens.surface.separator,
      "peekView.border": tokens.surface.separator,
      "peekViewEditor.background": tokens.surface.base,
      "peekViewResult.background": tokens.surface.chrome,
      "peekViewResult.selectionBackground": theme.ui.panelHover,
    },
  } as editor.IStandaloneThemeData & { semanticHighlighting: boolean };
}
