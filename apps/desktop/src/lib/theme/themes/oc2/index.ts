import type {
  CodeEditorTheme,
  ReactUiTheme,
  TerminalThemeColors,
  WorkspaceTheme,
} from "../../theme";
import codeEditor from "./code-editor.json";
import terminal from "./terminal.json";
import ui from "./ui.json";

export const oc2CodeEditorTheme: CodeEditorTheme = codeEditor;
export const oc2TerminalTheme: TerminalThemeColors = terminal;
export const oc2UiTheme: ReactUiTheme = ui;

export const oc2Theme: WorkspaceTheme = {
  id: "oc-2",
  name: "OC-2",
  mode: "dark",
  ui: oc2UiTheme,
  codeEditor: oc2CodeEditorTheme,
  terminal: oc2TerminalTheme,
};
