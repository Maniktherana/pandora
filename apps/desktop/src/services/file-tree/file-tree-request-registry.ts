/** Pending resolvers for async file reads/writes via runtime events. Not in Zustand — these don't drive React renders. */
export const pendingFileTreeReads = new Map<string, (content: string | null) => void>();
export const pendingFileTreeWrites = new Map<string, (error?: Error) => void>();
