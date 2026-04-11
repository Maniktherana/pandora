export type ThemeMode = "light" | "dark";

export type ScmUiTheme = {
  added: string;
  modified: string;
  deleted: string;
  renamed: string;
  conflict: string;
};

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
  scm: ScmUiTheme;
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
