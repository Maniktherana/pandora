import { ipcGetUiState, ipcSetUiState } from "@/lib/services/ipc/client";
import { preferenceKeys } from "./keys";

type FileTreeExpansionMap = Record<string, string[]>;

function parseExpansionMap(raw: string | null): FileTreeExpansionMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: FileTreeExpansionMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      const paths = value.filter((entry): entry is string => typeof entry === "string");
      if (paths.length > 0) out[key] = paths;
    }
    return out;
  } catch {
    return {};
  }
}

async function loadExpansionMap(): Promise<FileTreeExpansionMap> {
  return parseExpansionMap(await ipcGetUiState(preferenceKeys.fileTreeExpanded));
}

export async function loadFileTreeExpandedPaths(workspaceId: string): Promise<string[]> {
  const map = await loadExpansionMap();
  const paths = map[workspaceId];
  return Array.isArray(paths) ? paths : [];
}

let persistExpandedChain: Promise<void> = Promise.resolve();
const persistExpandedTimers = new Map<string, ReturnType<typeof setTimeout>>();
const persistExpandedSnapshots = new Map<string, string[]>();
const persistExpandedResolvers = new Map<string, Array<() => void>>();

export function persistFileTreeExpandedPaths(
  workspaceId: string,
  paths: Iterable<string>,
): Promise<void> {
  const nextPaths = Array.from(new Set(paths)).sort();
  persistExpandedSnapshots.set(workspaceId, nextPaths);

  return new Promise((resolve) => {
    const pendingResolvers = persistExpandedResolvers.get(workspaceId) ?? [];
    pendingResolvers.push(resolve);
    persistExpandedResolvers.set(workspaceId, pendingResolvers);

    const existingTimer = persistExpandedTimers.get(workspaceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      persistExpandedTimers.delete(workspaceId);
      const snapshot = persistExpandedSnapshots.get(workspaceId) ?? [];
      const run = async () => {
        const map = await loadExpansionMap();
        if (snapshot.length === 0) {
          delete map[workspaceId];
        } else {
          map[workspaceId] = snapshot;
        }
        await ipcSetUiState(preferenceKeys.fileTreeExpanded, JSON.stringify(map));
      };

      persistExpandedChain = persistExpandedChain
        .then(run)
        .catch((error) => {
          console.error("persistFileTreeExpandedPaths failed", error);
        })
        .finally(() => {
          const resolvers = persistExpandedResolvers.get(workspaceId) ?? [];
          persistExpandedResolvers.delete(workspaceId);
          resolvers.forEach((done) => done());
        });
    }, 500);

    persistExpandedTimers.set(workspaceId, timer);
  });
}
