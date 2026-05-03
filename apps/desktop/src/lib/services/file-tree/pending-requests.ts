/** Pending resolvers for async file reads/writes via IPC events. Not in Zustand; these do not drive React renders. */
export const pendingFileTreeReads = new Map<string, (content: string | null) => void>();
export const pendingFileTreeWrites = new Map<string, (error?: Error) => void>();
