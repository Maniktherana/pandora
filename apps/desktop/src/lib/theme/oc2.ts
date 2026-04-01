import type { CSSProperties } from "react";
import type { editor } from "monaco-editor";

type CodeSurfaceTokens = {
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

export const oc2CodeSurfaceTokens: CodeSurfaceTokens = {
  surface: {
    base: "#151515",
    chrome: "#121212",
    hover: "#1B1B1B",
    separator: "#242424",
  },
  text: {
    primary: "#EDEDED",
    muted: "#A0A0A0",
    subtle: "#707070",
    faint: "#505050",
    lineNumber: "#5C5C5C",
  },
  accent: {
    selection: "#0D172B",
    selectionInactive: "#2A2A2A",
  },
  diff: {
    add: {
      base: "#B8DB87",
      fill: "rgb(184 219 135 / 0.12)",
      fillStrong: "rgb(184 219 135 / 0.20)",
    },
    delete: {
      base: "#E26A75",
      fill: "rgb(226 106 117 / 0.12)",
      fillStrong: "rgb(226 106 117 / 0.20)",
    },
    modified: {
      base: "#F5A742",
      fill: "rgb(245 167 66 / 0.14)",
    },
  },
  gutter: {
    bar: {
      add: "#B8DB87",
      delete: "#E26A75",
      modified: "#F5A742",
    },
  },
  syntax: {
    comment: "#8F8F8F",
    keyword: "#EDB2F1",
    string: "#00CEB9",
    primitive: "#8CB0FF",
    property: "#FAB283",
    type: "#FCD53A",
    constant: "#93E9F6",
    operator: "#56B6C2",
    punctuation: "#EDEDED",
    variable: "#EDEDED",
  },
  cursor: "#FAB283",
  scrollbar: "#505050",
  scrollbarHover: "#707070",
};

export const oc2Theme = {
  id: "oc-2",
  name: "OC-2",
  mode: "dark" as const,
  colors: {
    background: oc2CodeSurfaceTokens.surface.base,
    panel: oc2CodeSurfaceTokens.surface.chrome,
    panelElevated: "#1A1A1A",
    panelHover: "#FFFFFF0D",
    panelInteractive: "#0D172B",
    border: oc2CodeSurfaceTokens.surface.separator,
    borderSubtle: "#1D1D1D",
    text: oc2CodeSurfaceTokens.text.primary,
    textMuted: oc2CodeSurfaceTokens.text.muted,
    textSubtle: oc2CodeSurfaceTokens.text.subtle,
    textFaint: oc2CodeSurfaceTokens.text.faint,
    primary: "#FAB283",
    success: "#12C905",
    successBg: "#022B00",
    warning: "#FCD53A",
    error: "#FC533A",
    errorBg: "#1F0603",
    info: "#EDB2F1",
    interactive: "#034CFF",
    diffAdd: oc2CodeSurfaceTokens.diff.add.base,
    diffDelete: oc2CodeSurfaceTokens.diff.delete.base,
    syntaxComment: oc2CodeSurfaceTokens.syntax.comment,
    syntaxKeyword: oc2CodeSurfaceTokens.syntax.keyword,
    syntaxString: oc2CodeSurfaceTokens.syntax.string,
    syntaxPrimitive: oc2CodeSurfaceTokens.syntax.primitive,
    syntaxProperty: oc2CodeSurfaceTokens.syntax.property,
    syntaxType: oc2CodeSurfaceTokens.syntax.type,
    syntaxConstant: oc2CodeSurfaceTokens.syntax.constant,
    cursor: oc2CodeSurfaceTokens.cursor,
    selection: oc2CodeSurfaceTokens.accent.selection,
    selectionInactive: oc2CodeSurfaceTokens.accent.selectionInactive,
    currentLine: oc2CodeSurfaceTokens.surface.hover,
    scrollbar: oc2CodeSurfaceTokens.scrollbar,
    scrollbarHover: oc2CodeSurfaceTokens.scrollbarHover,
  },
};

const rootVars: Record<string, string> = {
  "--oc-bg": oc2Theme.colors.background,
  "--oc-panel": oc2Theme.colors.panel,
  "--oc-panel-elevated": oc2Theme.colors.panelElevated,
  "--oc-panel-hover": oc2Theme.colors.panelHover,
  "--oc-panel-interactive": oc2Theme.colors.panelInteractive,
  "--oc-border": oc2Theme.colors.border,
  "--oc-border-subtle": oc2Theme.colors.borderSubtle,
  "--oc-text": oc2Theme.colors.text,
  "--oc-text-muted": oc2Theme.colors.textMuted,
  "--oc-text-subtle": oc2Theme.colors.textSubtle,
  "--oc-text-faint": oc2Theme.colors.textFaint,
  "--oc-primary": oc2Theme.colors.primary,
  "--oc-success": oc2Theme.colors.success,
  "--oc-success-bg": oc2Theme.colors.successBg,
  "--oc-warning": oc2Theme.colors.warning,
  "--oc-error": oc2Theme.colors.error,
  "--oc-error-bg": oc2Theme.colors.errorBg,
  "--oc-info": oc2Theme.colors.info,
  "--oc-interactive": oc2Theme.colors.interactive,
  "--oc-diff-add": oc2Theme.colors.diffAdd,
  "--oc-diff-delete": oc2Theme.colors.diffDelete,
  "--oc-selection": oc2Theme.colors.selection,
  "--oc-selection-inactive": oc2Theme.colors.selectionInactive,
  "--oc-scrollbar": oc2Theme.colors.scrollbar,
  "--oc-scrollbar-hover": oc2Theme.colors.scrollbarHover,
  "--oc-code-surface-base": oc2CodeSurfaceTokens.surface.base,
  "--oc-code-surface-chrome": oc2CodeSurfaceTokens.surface.chrome,
  "--oc-code-surface-hover": oc2CodeSurfaceTokens.surface.hover,
  "--oc-code-surface-separator": oc2CodeSurfaceTokens.surface.separator,
  "--oc-code-text-primary": oc2CodeSurfaceTokens.text.primary,
  "--oc-code-text-muted": oc2CodeSurfaceTokens.text.muted,
  "--oc-code-text-line-number": oc2CodeSurfaceTokens.text.lineNumber,
  "--oc-code-selection": oc2CodeSurfaceTokens.accent.selection,
  "--oc-code-selection-inactive": oc2CodeSurfaceTokens.accent.selectionInactive,
  "--oc-code-diff-add-base": oc2CodeSurfaceTokens.diff.add.base,
  "--oc-code-diff-add-fill": oc2CodeSurfaceTokens.diff.add.fill,
  "--oc-code-diff-add-fill-strong": oc2CodeSurfaceTokens.diff.add.fillStrong,
  "--oc-code-diff-delete-base": oc2CodeSurfaceTokens.diff.delete.base,
  "--oc-code-diff-delete-fill": oc2CodeSurfaceTokens.diff.delete.fill,
  "--oc-code-diff-delete-fill-strong": oc2CodeSurfaceTokens.diff.delete.fillStrong,
  "--oc-code-diff-modified-base": oc2CodeSurfaceTokens.diff.modified.base,
  "--oc-code-diff-modified-fill": oc2CodeSurfaceTokens.diff.modified.fill,
  "--oc-code-gutter-add": oc2CodeSurfaceTokens.gutter.bar.add,
  "--oc-code-gutter-delete": oc2CodeSurfaceTokens.gutter.bar.delete,
  "--oc-code-gutter-modified": oc2CodeSurfaceTokens.gutter.bar.modified,
  "--oc-syntax-comment": oc2CodeSurfaceTokens.syntax.comment,
  "--oc-syntax-keyword": oc2CodeSurfaceTokens.syntax.keyword,
  "--oc-syntax-string": oc2CodeSurfaceTokens.syntax.string,
  "--oc-syntax-primitive": oc2CodeSurfaceTokens.syntax.primitive,
  "--oc-syntax-property": oc2CodeSurfaceTokens.syntax.property,
  "--oc-syntax-type": oc2CodeSurfaceTokens.syntax.type,
  "--oc-syntax-constant": oc2CodeSurfaceTokens.syntax.constant,
  "--oc-syntax-operator": oc2CodeSurfaceTokens.syntax.operator,
  "--oc-syntax-punctuation": oc2CodeSurfaceTokens.syntax.punctuation,
  "--oc-syntax-variable": oc2CodeSurfaceTokens.syntax.variable,
};

export function applyOc2Theme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.add("dark");
  root.dataset.theme = oc2Theme.id;
  root.dataset.colorScheme = oc2Theme.mode;
  for (const [key, value] of Object.entries(rootVars)) {
    root.style.setProperty(key, value);
  }
}

export function toPierreVariables(tokens: CodeSurfaceTokens): CSSProperties {
  return {
    "--oc-code-surface-base": tokens.surface.base,
    "--oc-code-surface-chrome": tokens.surface.chrome,
    "--oc-code-surface-hover": tokens.surface.hover,
    "--oc-code-surface-separator": tokens.surface.separator,
    "--oc-code-text-primary": tokens.text.primary,
    "--oc-code-text-muted": tokens.text.muted,
    "--oc-code-text-line-number": tokens.text.lineNumber,
    "--oc-code-selection": tokens.accent.selection,
    "--oc-code-selection-inactive": tokens.accent.selectionInactive,
    "--oc-code-diff-add-base": tokens.diff.add.base,
    "--oc-code-diff-add-fill": tokens.diff.add.fill,
    "--oc-code-diff-add-fill-strong": tokens.diff.add.fillStrong,
    "--oc-code-diff-delete-base": tokens.diff.delete.base,
    "--oc-code-diff-delete-fill": tokens.diff.delete.fill,
    "--oc-code-diff-delete-fill-strong": tokens.diff.delete.fillStrong,
    "--oc-code-diff-modified-base": tokens.diff.modified.base,
    "--oc-code-diff-modified-fill": tokens.diff.modified.fill,
    "--oc-code-gutter-add": tokens.gutter.bar.add,
    "--oc-code-gutter-delete": tokens.gutter.bar.delete,
    "--oc-code-gutter-modified": tokens.gutter.bar.modified,
    "--oc-syntax-comment": tokens.syntax.comment,
    "--oc-syntax-keyword": tokens.syntax.keyword,
    "--oc-syntax-string": tokens.syntax.string,
    "--oc-syntax-primitive": tokens.syntax.primitive,
    "--oc-syntax-property": tokens.syntax.property,
    "--oc-syntax-type": tokens.syntax.type,
    "--oc-syntax-constant": tokens.syntax.constant,
    "--oc-syntax-operator": tokens.syntax.operator,
    "--oc-syntax-punctuation": tokens.syntax.punctuation,
    "--oc-syntax-variable": tokens.syntax.variable,
  } as CSSProperties;
}

export function toMonacoTheme(tokens: CodeSurfaceTokens): editor.IStandaloneThemeData {
  return {
    base: "vs-dark",
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
      "editorWidget.background": oc2Theme.colors.panelElevated,
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
      "list.hoverBackground": oc2Theme.colors.panelHover,
      "list.hoverForeground": tokens.text.primary,
      "list.inactiveSelectionBackground": tokens.surface.hover,
      "list.inactiveSelectionForeground": tokens.text.muted,
      "input.background": tokens.surface.chrome,
      "input.foreground": tokens.text.primary,
      "input.border": tokens.surface.separator,
      "inputOption.activeBorder": oc2Theme.colors.interactive,
      "inputOption.activeBackground": "#034CFF22",
      "dropdown.background": oc2Theme.colors.panelElevated,
      "dropdown.foreground": tokens.text.primary,
      "dropdown.border": tokens.surface.separator,
      "menu.background": oc2Theme.colors.panelElevated,
      "menu.foreground": tokens.text.primary,
      "menu.selectionBackground": oc2Theme.colors.panelHover,
      "menu.selectionForeground": tokens.text.primary,
      "menu.border": tokens.surface.separator,
      "peekView.border": tokens.surface.separator,
      "peekViewEditor.background": tokens.surface.base,
      "peekViewResult.background": tokens.surface.chrome,
      "peekViewResult.selectionBackground": oc2Theme.colors.panelHover,
    },
  } as editor.IStandaloneThemeData & { semanticHighlighting: boolean };
}

export function getOc2MonacoTheme(): editor.IStandaloneThemeData {
  return toMonacoTheme(oc2CodeSurfaceTokens);
}
