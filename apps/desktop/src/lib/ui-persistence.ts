import { invoke } from "@tauri-apps/api/core";

export const UI_KEYS = {
  sidebarVisible: "sidebar_visible",
  /** JSON map: workspaceId -> relative folder paths that stay expanded */
  workspaceFileTreeExpanded: "workspace_file_tree_expanded",
  /** JSON map: workspaceId -> whether the right file-tree panel was open */
  workspaceFileTreeOpen: "workspace_file_tree_open",
} as const;

export async function getUiState(key: string): Promise<string | null> {
  return invoke<string | null>("get_ui_state", { key });
}

export async function setUiState(key: string, value: string | null): Promise<void> {
  await invoke("set_ui_state", { key, value });
}

export async function loadPersistedSidebarVisible(): Promise<boolean> {
  const v = await getUiState(UI_KEYS.sidebarVisible);
  return v !== "false";
}

export async function persistSidebarVisible(visible: boolean): Promise<void> {
  await setUiState(UI_KEYS.sidebarVisible, visible ? "true" : "false");
}

type FileTreeExpansionMap = Record<string, string[]>;

function parseExpansionMap(raw: string | null): FileTreeExpansionMap {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    return o as FileTreeExpansionMap;
  } catch {
    return {};
  }
}

export async function loadFileTreeExpandedPaths(workspaceId: string): Promise<string[]> {
  const raw = await getUiState(UI_KEYS.workspaceFileTreeExpanded);
  const map = parseExpansionMap(raw);
  return map[workspaceId] ?? [];
}

export async function persistFileTreeExpandedPaths(
  workspaceId: string,
  paths: Iterable<string>
): Promise<void> {
  const raw = await getUiState(UI_KEYS.workspaceFileTreeExpanded);
  const map = parseExpansionMap(raw);
  map[workspaceId] = Array.from(new Set(paths)).sort();
  await setUiState(UI_KEYS.workspaceFileTreeExpanded, JSON.stringify(map));
}

type FileTreeOpenMap = Record<string, boolean>;

function parseOpenMap(raw: string | null): FileTreeOpenMap {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: FileTreeOpenMap = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadFileTreeOpenForWorkspace(workspaceId: string): Promise<boolean> {
  const raw = await getUiState(UI_KEYS.workspaceFileTreeOpen);
  const map = parseOpenMap(raw);
  return map[workspaceId] === true;
}

export async function persistFileTreeOpenForWorkspace(
  workspaceId: string,
  open: boolean
): Promise<void> {
  const raw = await getUiState(UI_KEYS.workspaceFileTreeOpen);
  const map = parseOpenMap(raw);
  if (open) {
    map[workspaceId] = true;
  } else {
    delete map[workspaceId];
  }
  await setUiState(UI_KEYS.workspaceFileTreeOpen, JSON.stringify(map));
}
