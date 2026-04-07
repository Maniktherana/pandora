import { createContext, useContext } from "react";
import type { ExpansionCtx } from "./files.types";

export const FileTreeExpansionContext = createContext<ExpansionCtx | null>(null);

export function useFileTreeExpansion(): ExpansionCtx {
  const ctx = useContext(FileTreeExpansionContext);
  if (!ctx) throw new Error("useFileTreeExpansion outside provider");
  return ctx;
}

