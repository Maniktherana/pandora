import { create } from "zustand";

interface EditorStoreState {
  bufferByWorkspace: Record<string, Record<string, string>>;
  savedContentByWorkspace: Record<string, Record<string, string>>;
  /** Fast dirty flags set synchronously from Monaco model changes. */
  dirtyFlags: Record<string, Record<string, boolean>>;
  /** Paths modified on disk while open in the editor (scopeId -> Set<relativePath>). */
  diskModifiedByWorkspace: Record<string, Set<string>>;

  setBuffer: (workspaceId: string, relativePath: string, value: string) => void;
  /** Mark a file as dirty (synchronous, no content copy). */
  markDirty: (workspaceId: string, relativePath: string) => void;
  forgetFile: (workspaceId: string, relativePath: string) => void;
  /** Set buffer + saved from disk (e.g. after layout restore). */
  mergeDiskContent: (workspaceId: string, relativePath: string, content: string) => void;
  isFileDirty: (workspaceId: string, relativePath: string) => boolean;
  /** Mark a file as modified on disk (from editor_file_changed runtime event). */
  markDiskModified: (workspaceId: string, relativePath: string) => void;
  /** Clear disk-modified mark after user reloads. */
  clearDiskModified: (workspaceId: string, relativePath: string) => void;
}

export const useEditorStore = create<EditorStoreState>((set, get) => ({
  bufferByWorkspace: {},
  savedContentByWorkspace: {},
  dirtyFlags: {},
  diskModifiedByWorkspace: {},

  setBuffer: (workspaceId, relativePath, value) => {
    set((s) => ({
      bufferByWorkspace: {
        ...s.bufferByWorkspace,
        [workspaceId]: {
          ...s.bufferByWorkspace[workspaceId],
          [relativePath]: value,
        },
      },
      dirtyFlags: {
        ...s.dirtyFlags,
        [workspaceId]: {
          ...s.dirtyFlags[workspaceId],
          [relativePath]: value !== s.savedContentByWorkspace[workspaceId]?.[relativePath],
        },
      },
    }));
  },

  markDirty: (workspaceId, relativePath) => {
    if (get().dirtyFlags[workspaceId]?.[relativePath]) return;
    set((s) => ({
      dirtyFlags: {
        ...s.dirtyFlags,
        [workspaceId]: { ...s.dirtyFlags[workspaceId], [relativePath]: true },
      },
    }));
  },

  mergeDiskContent: (workspaceId, relativePath, content) => {
    set((s) => ({
      bufferByWorkspace: {
        ...s.bufferByWorkspace,
        [workspaceId]: {
          ...s.bufferByWorkspace[workspaceId],
          [relativePath]: content,
        },
      },
      savedContentByWorkspace: {
        ...s.savedContentByWorkspace,
        [workspaceId]: {
          ...s.savedContentByWorkspace[workspaceId],
          [relativePath]: content,
        },
      },
      dirtyFlags: {
        ...s.dirtyFlags,
        [workspaceId]: { ...s.dirtyFlags[workspaceId], [relativePath]: false },
      },
    }));
  },

  forgetFile: (workspaceId, relativePath) => {
    set((s) => {
      const buffers = { ...s.bufferByWorkspace[workspaceId] };
      delete buffers[relativePath];
      const saved = { ...s.savedContentByWorkspace[workspaceId] };
      delete saved[relativePath];
      const dirty = { ...s.dirtyFlags[workspaceId] };
      delete dirty[relativePath];
      return {
        bufferByWorkspace: { ...s.bufferByWorkspace, [workspaceId]: buffers },
        savedContentByWorkspace: { ...s.savedContentByWorkspace, [workspaceId]: saved },
        dirtyFlags: { ...s.dirtyFlags, [workspaceId]: dirty },
      };
    });
  },

  isFileDirty: (workspaceId, relativePath) => {
    return get().dirtyFlags[workspaceId]?.[relativePath] === true;
  },

  markDiskModified: (workspaceId, relativePath) => {
    set((s) => {
      const current = s.diskModifiedByWorkspace[workspaceId] ?? new Set<string>();
      const next = new Set(current);
      next.add(relativePath);
      return {
        diskModifiedByWorkspace: { ...s.diskModifiedByWorkspace, [workspaceId]: next },
      };
    });
  },

  clearDiskModified: (workspaceId, relativePath) => {
    set((s) => {
      const current = s.diskModifiedByWorkspace[workspaceId];
      if (!current?.has(relativePath)) return s;
      const next = new Set(current);
      next.delete(relativePath);
      return {
        diskModifiedByWorkspace: { ...s.diskModifiedByWorkspace, [workspaceId]: next },
      };
    });
  },
}));
