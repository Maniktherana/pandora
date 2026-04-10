import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useRuntimeState } from "@/hooks/use-desktop-view";
import TerminalSurface from "@/components/terminal/terminal-surface";
import DotGridLoader from "@/components/dot-grid-loader";
import { terminalTheme } from "@/lib/terminal/terminal-theme";
import {
  SETTINGS_PREVIEW_NAME,
  SETTINGS_PREVIEW_SESSION_DEF_ID_PREFIX,
  SETTINGS_PREVIEW_SLOT_ID_PREFIX,
  SETTINGS_PREVIEW_RUNTIME_ID,
  isSettingsPreviewSlot,
} from "@/lib/terminal/settings-preview";
import type { ClientMessage, DaemonMessage, SessionState } from "@/lib/shared/types";

const SETTINGS_PREVIEW_HEIGHT_CLASS = "h-[320px]";

const settingsPreviewState: {
  runtimeId: string | null;
  slotId: string | null;
  sessionDefId: string | null;
  sessionId: string | null;
  initializing: Promise<{ runtimeId: string; sessionId: string }> | null;
} = {
  runtimeId: null,
  slotId: null,
  sessionDefId: null,
  sessionId: null,
  initializing: null,
};

async function sendRuntimeMessage(workspaceId: string, message: ClientMessage) {
  await invoke("daemon_send", {
    workspaceId,
    message: JSON.stringify(message),
  });
}

function ensureSettingsPreviewTerminal(workspacePath: string) {
  const workspaceId = SETTINGS_PREVIEW_RUNTIME_ID;
  if (
    settingsPreviewState.runtimeId === workspaceId &&
    settingsPreviewState.sessionId
  ) {
    return Promise.resolve({
      runtimeId: workspaceId,
      sessionId: settingsPreviewState.sessionId,
    });
  }

  if (settingsPreviewState.initializing) {
    return settingsPreviewState.initializing;
  }

  const previewSlotId = `${SETTINGS_PREVIEW_SLOT_ID_PREFIX}${crypto.randomUUID()}`;
  const previewSessionDefId = `${SETTINGS_PREVIEW_SESSION_DEF_ID_PREFIX}${crypto.randomUUID()}`;
  settingsPreviewState.runtimeId = workspaceId;
  settingsPreviewState.slotId = previewSlotId;
  settingsPreviewState.sessionDefId = previewSessionDefId;

  const init = (async () => {
    const cleanup: {
      connectionUnlisten: UnlistenFn | null;
      sessionUnlisten: UnlistenFn | null;
    } = {
      connectionUnlisten: null,
      sessionUnlisten: null,
    };

    try {
      const waitForConnection = new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("connection timeout")), 8000);

        cleanup.connectionUnlisten = await listen<string>("daemon-connection", (event) => {
          try {
            const payload = JSON.parse(event.payload) as {
              workspaceId?: string;
              state?: string;
            };
            if (payload.workspaceId !== workspaceId) return;
            if (payload.state !== "connected") return;
            clearTimeout(timeout);
            resolve();
          } catch {}
        });
      });

      const waitForSession = new Promise<string>(async (resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("session timeout")), 8000);

        const finish = (session: SessionState | null | undefined) => {
          if (!session?.id) return;
          if (session.sessionDefID !== previewSessionDefId) return;
          clearTimeout(timeout);
          resolve(session.id);
        };

        cleanup.sessionUnlisten = await listen<string>("daemon-message", (event) => {
          try {
            const payload =
              typeof event.payload === "string"
                ? (JSON.parse(event.payload) as DaemonMessage)
                : (event.payload as DaemonMessage);

            if (payload.workspaceId !== workspaceId) return;

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
        });
      });

      const shellPath =
        (window as typeof window & { __PANDORA_SHELL__?: string }).__PANDORA_SHELL__ ?? "/bin/zsh";

      await invoke("start_workspace_runtime", {
        workspaceId,
        workspacePath,
        defaultCwd: workspacePath,
      });
      await waitForConnection;

      await sendRuntimeMessage(workspaceId, {
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

      await sendRuntimeMessage(workspaceId, {
        type: "create_session_def",
        session: {
          id: previewSessionDefId,
          slotID: previewSlotId,
          kind: "terminal",
          name: SETTINGS_PREVIEW_NAME,
          command: `exec ${shellPath} -i`,
          cwd: null,
          port: null,
          envOverrides: {
            PANDORA_RUNTIME_ID: workspaceId,
            PANDORA_SLOT_ID: previewSlotId,
          },
          restartPolicy: "manual",
          pauseSupported: false,
          resumeSupported: false,
        },
      });

      await sendRuntimeMessage(workspaceId, {
        type: "open_session_instance",
        sessionDefID: previewSessionDefId,
      });

      const sessionId = await waitForSession;
      settingsPreviewState.sessionId = sessionId;

      return { runtimeId: workspaceId, sessionId };
    } finally {
      if (cleanup.connectionUnlisten) {
        await cleanup.connectionUnlisten();
      }
      if (cleanup.sessionUnlisten) {
        await cleanup.sessionUnlisten();
      }
    }
  })();

  settingsPreviewState.initializing = init.then(
    (result) => {
      settingsPreviewState.initializing = null;
      return result;
    },
    (error) => {
      settingsPreviewState.initializing = null;
      settingsPreviewState.runtimeId = null;
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
    settingsPreviewState.runtimeId,
  );
  const [error, setError] = useState(false);
  const activeWorkspaceSlots = useRuntimeState(
    activeWorkspaceId ?? "",
    (runtime) => runtime?.slots ?? [],
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--theme-font-terminal", fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    if (!activeWorkspaceId) return;

    const leakedPreviewSlots = activeWorkspaceSlots.filter((slot) => isSettingsPreviewSlot(slot));
    if (leakedPreviewSlots.length === 0) return;

    void Promise.all(
      leakedPreviewSlots.map((slot) =>
        sendRuntimeMessage(activeWorkspaceId, {
          type: "remove_slot",
          slotID: slot.id,
        }).catch(() => undefined),
      ),
    );
  }, [activeWorkspaceId, activeWorkspaceSlots]);

  useEffect(() => {
    if (settingsPreviewState.sessionId && settingsPreviewState.runtimeId) {
      setSessionId(settingsPreviewState.sessionId);
      setPreviewRuntimeId(settingsPreviewState.runtimeId);
      setError(false);
      return;
    }

    if (!activeWorkspacePath) return;

    let cancelled = false;

    const startPreview = async () => {
      try {
        const preview = await ensureSettingsPreviewTerminal(activeWorkspacePath);
        if (!cancelled) {
          setPreviewRuntimeId(preview.runtimeId);
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

    void startPreview();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspacePath]);

  if (error) {
    return (
      <div
        className={`flex ${SETTINGS_PREVIEW_HEIGHT_CLASS} w-full items-center justify-center rounded-lg border border-[var(--theme-border)] text-xs text-[var(--theme-text-faint)]`}
        style={{ background: terminalTheme.background ?? "#0a0a0a" }}
      >
        Terminal preview unavailable
      </div>
    );
  }

  if ((!activeWorkspacePath && !previewRuntimeId) || !sessionId) {
    return (
      <div
        className={`flex ${SETTINGS_PREVIEW_HEIGHT_CLASS} w-full items-center justify-center rounded-lg border border-[var(--theme-border)]`}
        style={{ background: terminalTheme.background ?? "#0a0a0a" }}
      >
        <DotGridLoader variant="default" gridSize={5} sizeClassName="h-6 w-6" className="opacity-60" />
      </div>
    );
  }

  return (
    <div className={`${SETTINGS_PREVIEW_HEIGHT_CLASS} w-full overflow-hidden rounded-lg border border-[var(--theme-border)]`}>
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
