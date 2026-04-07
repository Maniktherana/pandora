import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface EditorStoreState {
  bufferByWorkspace: Record<string, Record<string, string>>;
  savedContentByWorkspace: Record<string, Record<string, string>>;

  /** Load disk content if missing so the editor can be opened by the workspace service. */
  ensureFileLoaded: (
    workspaceId: string,
    workspaceRoot: string,
    relativePath: string,
  ) => Promise<boolean>;
  setBuffer: (workspaceId: string, relativePath: string, value: string) => void;
  forgetFile: (workspaceId: string, relativePath: string) => void;
  /** Set buffer + saved from disk (e.g. after layout restore). */
  mergeDiskContent: (workspaceId: string, relativePath: string, content: string) => void;
  saveFile: (workspaceId: string, workspaceRoot: string, relativePath: string) => Promise<boolean>;
  isFileDirty: (workspaceId: string, relativePath: string) => boolean;
}

export const useEditorStore = create<EditorStoreState>((set, get) => ({
  bufferByWorkspace: {},
  savedContentByWorkspace: {},

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
    }));
  },

  forgetFile: (workspaceId, relativePath) => {
    set((s) => {
      const buffers = { ...s.bufferByWorkspace[workspaceId] };
      delete buffers[relativePath];
      const saved = { ...s.savedContentByWorkspace[workspaceId] };
      delete saved[relativePath];
      return {
        bufferByWorkspace: { ...s.bufferByWorkspace, [workspaceId]: buffers },
        savedContentByWorkspace: { ...s.savedContentByWorkspace, [workspaceId]: saved },
      };
    });
  },

  saveFile: async (workspaceId, workspaceRoot, relativePath) => {
    const buf = get().bufferByWorkspace[workspaceId]?.[relativePath];
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
      savedContentByWorkspace: {
        ...s.savedContentByWorkspace,
        [workspaceId]: {
          ...s.savedContentByWorkspace[workspaceId],
          [relativePath]: buf,
        },
      },
    }));
    return true;
  },

  isFileDirty: (workspaceId, relativePath) => {
    const buf = get().bufferByWorkspace[workspaceId]?.[relativePath];
    if (buf === undefined) return false;
    const saved = get().savedContentByWorkspace[workspaceId]?.[relativePath];
    return saved === undefined || buf !== saved;
  },
}));
