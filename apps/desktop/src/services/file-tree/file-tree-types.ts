/** A single row in the flat, ordered visible file tree list. */
export type FileTreeVisibleRow = {
  id: string;
  path: string;
  parentPath: string;
  name: string;
  kind: "file" | "directory";
  depth: number;
  /** True only for directory rows that are currently open. */
  isExpanded: boolean;
  isIgnored: boolean;
};
