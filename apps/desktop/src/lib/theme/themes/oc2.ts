import type {
  CodeEditorTheme,
  ReactUiTheme,
  TerminalThemeColors,
  WorkspaceTheme,
} from "@/lib/theme/theme";
import codeEditor from "./oc2/code-editor.json";
import terminal from "./oc2/terminal.json";
import ui from "./oc2/ui.json";

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
