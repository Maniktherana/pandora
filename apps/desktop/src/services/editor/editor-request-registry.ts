/** Pending resolvers for async reads/writes via runtime events. Not in Zustand — these don't drive React renders. */
export const pendingEditorReads = new Map<string, (content: string | null) => void>();
export const pendingEditorWrites = new Map<string, (error?: Error) => void>();
