/** Pending resolvers for async reads/writes via IPC events. Not in Zustand; these do not drive React renders. */
export const pendingEditorReads = new Map<string, (content: string | null) => void>();
export const pendingEditorWrites = new Map<string, (error?: Error) => void>();
