import { Effect } from "effect";
import { useMemo } from "react";
import { tryCloseEditorTab } from "@/components/editor/close-dirty-editor";
import { DesktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import { useEditorStore } from "@/state/editor-store";
import { useDesktopEffectRunner } from "./use-bootstrap-desktop";

export function useEditorActions() {
  const { runPromise } = useDesktopEffectRunner();
  const ensureFileLoaded = useEditorStore((state) => state.ensureFileLoaded);

  return useMemo(
    () => ({
      async openFile(workspaceId: string, workspaceRoot: string, relativePath: string) {
        const ok = await ensureFileLoaded(workspaceId, workspaceRoot, relativePath);
        if (!ok) return;
        await runPromise(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            Effect.flatMap(service.getWorkspaceSession(workspaceId), (session) =>
              session.commands.addEditorTab(relativePath)
            )
          )
        );
      },

      async closeEditorTab(params: {
        workspaceId: string;
        workspaceRoot: string;
        paneID: string;
        tabIndex: number;
        relativePath: string;
        displayName: string;
      }) {
        await tryCloseEditorTab({
          ...params,
          closeTab: (paneID, tabIndex) =>
            runPromise(
              Effect.flatMap(DesktopWorkspaceService, (service) =>
                Effect.flatMap(service.getWorkspaceSession(params.workspaceId), (session) =>
                  session.commands.closeTab(paneID, tabIndex)
                )
              )
            ),
        });
      },
    }),
    [ensureFileLoaded, runPromise]
  );
}
