import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTerminalScopeStore } from "@/lib/services/terminal/store";
import TerminalSurface from "@/components/terminal/terminal-surface";
import DotGridLoader from "@/components/dot-grid-loader";
import {
  SETTINGS_PREVIEW_NAME,
  SETTINGS_PREVIEW_SESSION_DEF_ID_PREFIX,
  SETTINGS_PREVIEW_SLOT_ID_PREFIX,
  SETTINGS_PREVIEW_RUNTIME_ID,
  isSettingsPreviewSlot,
} from "@/lib/shared/terminal/settings-preview";
import type {
  RuntimeCommand,
  RuntimeEventEnvelope,
  SessionState,
  SlotState,
} from "@/lib/shared/shared.types";

const SETTINGS_PREVIEW_HEIGHT_CLASS = "h-[320px]";
const EMPTY_SLOTS: readonly SlotState[] = [];

const settingsPreviewState: {
  scopeId: string | null;
  slotId: string | null;
  sessionDefId: string | null;
  sessionId: string | null;
  initializing: Promise<{ scopeId: string; sessionId: string }> | null;
} = {
  scopeId: null,
  slotId: null,
  sessionDefId: null,
  sessionId: null,
  initializing: null,
};

async function sendRuntimeMessage(scopeId: string, message: RuntimeCommand) {
  await invoke("scope_send", {
    scopeId,
    message: JSON.stringify(message),
  });
}

function ensureSettingsPreviewTerminal(workspacePath: string) {
  const scopeId = SETTINGS_PREVIEW_RUNTIME_ID;
  if (settingsPreviewState.scopeId === scopeId && settingsPreviewState.sessionId) {
    return Promise.resolve({
      scopeId,
      sessionId: settingsPreviewState.sessionId,
    });
  }

  if (settingsPreviewState.initializing) {
    return settingsPreviewState.initializing;
  }

  const previewSlotId = `${SETTINGS_PREVIEW_SLOT_ID_PREFIX}${crypto.randomUUID()}`;
  const previewSessionDefId = `${SETTINGS_PREVIEW_SESSION_DEF_ID_PREFIX}${crypto.randomUUID()}`;
  settingsPreviewState.scopeId = scopeId;
  settingsPreviewState.slotId = previewSlotId;
  settingsPreviewState.sessionDefId = previewSessionDefId;

  const init = (async () => {
    const cleanup: { sessionUnlisten: UnlistenFn | null } = { sessionUnlisten: null };

    try {
      const waitForSession = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("session timeout")), 8000);

        const finish = (session: SessionState | null | undefined) => {
          if (!session?.id) return;
          if (session.sessionDefID !== previewSessionDefId) return;
          clearTimeout(timeout);
          resolve(session.id);
        };

        listen<RuntimeEventEnvelope>("runtime-event", (event) => {
          try {
            const payload = event.payload;
            if (payload.runtimeId !== scopeId) return;

            if (payload.type === "session_opened") {
              finish(payload.session);
              return;
            }

            if (payload.type === "session_snapshot") {
              finish(
                payload.sessions.find(
                  (candidate) => candidate.sessionDefID === previewSessionDefId,
                ) ?? null,
              );
            }
          } catch {}
        })
          .then((unlisten) => {
            cleanup.sessionUnlisten = unlisten;
          })
          .catch(reject);
      });

      const shellPath =
        (window as typeof window & { __PANDORA_SHELL__?: string }).__PANDORA_SHELL__ ?? "/bin/zsh";

      await sendRuntimeMessage(scopeId, {
        type: "create_slot",
        slot: {
          id: previewSlotId,
          kind: "terminal_slot",
          name: SETTINGS_PREVIEW_NAME,
          autostart: true,
          presentationMode: "single",
          primarySessionDefID: previewSessionDefId,
          sessionDefIDs: [previewSessionDefId],
          persisted: false,
          sortOrder: Date.now(),
        },
      });

      await sendRuntimeMessage(scopeId, {
        type: "create_session_def",
        session: {
          id: previewSessionDefId,
          slotID: previewSlotId,
          kind: "terminal",
          name: SETTINGS_PREVIEW_NAME,
          command: `exec ${shellPath} -i`,
          cwd: workspacePath,
          port: null,
          envOverrides: {
            PANDORA_RUNTIME_ID: scopeId,
            PANDORA_SLOT_ID: previewSlotId,
          },
          restartPolicy: "manual",
          pauseSupported: false,
          resumeSupported: false,
        },
      });

      await sendRuntimeMessage(scopeId, {
        type: "open_session_instance",
        sessionDefID: previewSessionDefId,
      });

      const sessionId = await waitForSession;
      settingsPreviewState.sessionId = sessionId;

      return { scopeId, sessionId };
    } finally {
      if (cleanup.sessionUnlisten) cleanup.sessionUnlisten();
    }
  })();

  settingsPreviewState.initializing = init.then(
    (result) => {
      settingsPreviewState.initializing = null;
      return result;
    },
    (error) => {
      settingsPreviewState.initializing = null;
      settingsPreviewState.scopeId = null;
      settingsPreviewState.slotId = null;
      settingsPreviewState.sessionDefId = null;
      settingsPreviewState.sessionId = null;
      throw error;
    },
  );

  return settingsPreviewState.initializing;
}

interface TerminalFontPreviewProps {
  fontFamily: string;
  activeWorkspaceId: string | null;
  activeWorkspacePath: string | null;
}

export default function TerminalFontPreview({
  fontFamily,
  activeWorkspaceId,
  activeWorkspacePath,
}: TerminalFontPreviewProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewRuntimeId, setPreviewRuntimeId] = useState<string | null>(
    settingsPreviewState.scopeId,
  );
  const [error, setError] = useState(false);
  const activeWorkspaceSlots = useTerminalScopeStore(
    (s) => s.byScopeId[activeWorkspaceId ?? ""]?.slots ?? EMPTY_SLOTS,
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--theme-font-terminal", fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    if (!activeWorkspaceId) return;

    const leakedPreviewSlots = activeWorkspaceSlots.filter((slot) => isSettingsPreviewSlot(slot));
    if (leakedPreviewSlots.length === 0) return;

    Promise.all(
      leakedPreviewSlots.map((slot) =>
        sendRuntimeMessage(activeWorkspaceId, {
          type: "remove_slot",
          slotID: slot.id,
        }).catch(() => undefined),
      ),
    ).catch((err) => console.warn("Failed to remove leaked preview slots:", err));
  }, [activeWorkspaceId, activeWorkspaceSlots]);

  useEffect(() => {
    if (settingsPreviewState.sessionId && settingsPreviewState.scopeId) {
      setSessionId(settingsPreviewState.sessionId);
      setPreviewRuntimeId(settingsPreviewState.scopeId);
      setError(false);
      return;
    }

    if (!activeWorkspacePath) return;

    let cancelled = false;

    const startPreview = async () => {
      try {
        const preview = await ensureSettingsPreviewTerminal(activeWorkspacePath);
        if (!cancelled) {
          setPreviewRuntimeId(preview.scopeId);
          setSessionId(preview.sessionId);
          setError(false);
        }
      } catch (err) {
        console.error("[settings-terminal]", err);
        if (!cancelled) {
          setError(true);
        }
      }
    };

    startPreview().catch((err) => {
      console.error("[settings-terminal] unexpected startup error:", err);
      if (!cancelled) setError(true);
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspacePath]);

  if (error) {
    return (
      <div
        className={`flex ${SETTINGS_PREVIEW_HEIGHT_CLASS} w-full items-center justify-center rounded-lg border border-[var(--theme-border)] text-xs text-[var(--theme-text-faint)]`}
        style={{ background: "var(--theme-terminal-bg, var(--theme-bg))" }}
      >
        Terminal preview unavailable
      </div>
    );
  }

  if ((!activeWorkspacePath && !previewRuntimeId) || !sessionId) {
    return (
      <div
        className={`flex ${SETTINGS_PREVIEW_HEIGHT_CLASS} w-full items-center justify-center rounded-lg border border-[var(--theme-border)]`}
        style={{ background: "var(--theme-terminal-bg, var(--theme-bg))" }}
      >
        <DotGridLoader
          variant="default"
          gridSize={5}
          sizeClassName="h-6 w-6"
          className="opacity-60"
        />
      </div>
    );
  }

  return (
    <div
      className={`${SETTINGS_PREVIEW_HEIGHT_CLASS} w-full overflow-hidden rounded-lg border border-[var(--theme-border)]`}
    >
      <TerminalSurface
        sessionID={sessionId}
        workspaceId={previewRuntimeId ?? SETTINGS_PREVIEW_RUNTIME_ID}
        surfaceId={sessionId}
        visible={true}
        focused={false}
        overlayExempt={true}
      />
    </div>
  );
}
