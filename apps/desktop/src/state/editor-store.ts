import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface EditorStoreState {
  bufferByWorkspace: Record<string, Record<string, string>>;
  savedContentByWorkspace: Record<string, Record<string, string>>;
  /** Fast dirty flags set synchronously from Monaco model changes. */
  dirtyFlags: Record<string, Record<string, boolean>>;

  /** Load disk content if missing so the editor can be opened by the workspace service. */
  ensureFileLoaded: (
    workspaceId: string,
    workspaceRoot: string,
    relativePath: string,
  ) => Promise<boolean>;
  setBuffer: (workspaceId: string, relativePath: string, value: string) => void;
  /** Mark a file as dirty (synchronous, no content copy). */
  markDirty: (workspaceId: string, relativePath: string) => void;
  forgetFile: (workspaceId: string, relativePath: string) => void;
  /** Set buffer + saved from disk (e.g. after layout restore). */
  mergeDiskContent: (workspaceId: string, relativePath: string, content: string) => void;
  /** Save a file. If `content` is provided it's used directly; otherwise falls back to buffer. */
  saveFile: (
    workspaceId: string,
    workspaceRoot: string,
    relativePath: string,
    content?: string,
  ) => Promise<boolean>;
  isFileDirty: (workspaceId: string, relativePath: string) => boolean;
}

export const useEditorStore = create<EditorStoreState>((set, get) => ({
  bufferByWorkspace: {},
  savedContentByWorkspace: {},
  dirtyFlags: {},

  ensureFileLoaded: async (workspaceId, workspaceRoot, relativePath) => {
    const existing = get().bufferByWorkspace[workspaceId]?.[relativePath];
    if (existing === undefined) {
      try {
        const content = await invoke<string>("read_workspace_text_file", {
          workspaceRoot,
          relativePath,
        });
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
        }));
      } catch (e) {
        console.error("Failed to open file:", e);
        return false;
      }
    }
    return true;
  },

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

  saveFile: async (workspaceId, workspaceRoot, relativePath, content?) => {
    const buf = content ?? get().bufferByWorkspace[workspaceId]?.[relativePath];
    if (buf === undefined) return false;
    try {
      await invoke("write_workspace_text_file", {
        workspaceRoot,
        relativePath,
        contents: buf,
      });
    } catch (e) {
      console.error("Failed to save file:", e);
      return false;
    }
    set((s) => ({
      bufferByWorkspace: {
        ...s.bufferByWorkspace,
        [workspaceId]: {
          ...s.bufferByWorkspace[workspaceId],
          [relativePath]: buf,
        },
      },
      savedContentByWorkspace: {
        ...s.savedContentByWorkspace,
        [workspaceId]: {
          ...s.savedContentByWorkspace[workspaceId],
          [relativePath]: buf,
        },
      },
      dirtyFlags: {
        ...s.dirtyFlags,
        [workspaceId]: { ...s.dirtyFlags[workspaceId], [relativePath]: false },
      },
    }));
    return true;
  },

  isFileDirty: (workspaceId, relativePath) => {
    return get().dirtyFlags[workspaceId]?.[relativePath] === true;
  },
}));
