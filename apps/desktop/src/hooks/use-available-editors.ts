import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

export interface EditorInfo {
  id: string;
  displayName: string;
  category: string;
}

export function useAvailableEditors() {
  return useQuery({
    queryKey: ["available-editors"],
    queryFn: () => invoke<EditorInfo[]>("list_available_editors"),
    staleTime: Infinity,
  });
}
