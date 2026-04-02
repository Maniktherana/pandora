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
    const out: FileTreeExpansionMap = {};
    for (const [k, v] of Object.entries(o)) {
      if (!Array.isArray(v)) continue;
      const paths = v.filter((x): x is string => typeof x === "string");
      if (paths.length > 0) out[k] = paths;
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadFileTreeExpandedPaths(workspaceId: string): Promise<string[]> {
  const raw = await getUiState(UI_KEYS.workspaceFileTreeExpanded);
  const map = parseExpansionMap(raw);
  const v = map[workspaceId];
  return Array.isArray(v) ? v : [];
}

/** Serialize expanded-map updates so concurrent read-modify-write cannot drop a workspace's paths. */
let persistExpandedChain: Promise<void> = Promise.resolve();

export function persistFileTreeExpandedPaths(
  workspaceId: string,
  paths: Iterable<string>
): Promise<void> {
  const nextPaths = Array.from(new Set(paths)).sort();
  const run = async () => {
    const raw = await getUiState(UI_KEYS.workspaceFileTreeExpanded);
    const map = parseExpansionMap(raw);
    if (nextPaths.length === 0) {
      delete map[workspaceId];
    } else {
      map[workspaceId] = nextPaths;
    }
    await setUiState(UI_KEYS.workspaceFileTreeExpanded, JSON.stringify(map));
  };
  persistExpandedChain = persistExpandedChain.then(run).catch((e) => {
    console.error("persistFileTreeExpandedPaths failed", e);
  });
  return persistExpandedChain;
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

export async function loadPersistedFileTreeOpenMap(): Promise<Record<string, boolean>> {
  const raw = await getUiState(UI_KEYS.workspaceFileTreeOpen);
  return parseOpenMap(raw);
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
