import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { File as PierreFile } from "@pierre/diffs/react";
import { useEditorStore } from "@/stores/editor-store";
import { createPierreFile, createPierreFileOptions, getPierreSurfaceStyle } from "@/lib/editor/pierre-pandora";
import { oc2CodeSurfaceTokens } from "@/lib/theme/oc2";

const reviewLoading = (
  <div
    className="h-full w-full"
    style={{ backgroundColor: oc2CodeSurfaceTokens.surface.base }}
    aria-hidden
  />
);

export default function ReviewFileViewer({
  workspaceId,
  workspaceRoot,
  relativePath,
  isActive,
}: {
  workspaceId: string;
  workspaceRoot: string;
  relativePath: string;
  isActive: boolean;
}) {
  const buffer = useEditorStore(
    (s) => s.bufferByWorkspace[workspaceId]?.[relativePath]
  );
  const mergeSaved = useEditorStore((s) => s.mergeDiskContent);

  useEffect(() => {
    if (!isActive || buffer !== undefined) return;
    let cancelled = false;
    void invoke<string>("read_workspace_text_file", {
      workspaceRoot,
      relativePath,
    })
      .then((content) => {
        if (!cancelled) mergeSaved(workspaceId, relativePath, content);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [buffer, isActive, mergeSaved, relativePath, workspaceId, workspaceRoot]);

  if (!isActive) {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ backgroundColor: oc2CodeSurfaceTokens.surface.base }}
        aria-hidden
      />
    );
  }

  if (buffer === undefined) {
    return reviewLoading;
  }

  return (
    <div
      className="absolute inset-0 min-h-0 overflow-auto"
      style={{
        ...getPierreSurfaceStyle(),
        backgroundColor: oc2CodeSurfaceTokens.surface.base,
      }}
    >
      <PierreFile
        file={createPierreFile(relativePath, buffer)}
        options={createPierreFileOptions()}
        className="block h-full min-h-full w-full"
      />
    </div>
  );
}
