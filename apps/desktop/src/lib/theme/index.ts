export {
  applyTheme,
  defaultScmTheme,
  deriveChromeTiers,
  deriveCodeEditorTextTiers,
  derivePanelElevated,
  getDocumentStaticThemeCss,
  getShadcnRootCssVariables,
  getThemeCssVariables,
  mergeScmTheme,
  toMonacoTheme,
  toPierreVariables,
} from "./theme";
export type {
  CodeEditorTheme,
  ReactUiTheme,
  ScmUiTheme,
  TerminalThemeColors,
  ThemeMode,
  WorkspaceTheme,
} from "./theme.types";

export { defaultTheme, themes } from "./themes";
export { oc2Theme } from "./themes/oc2";
