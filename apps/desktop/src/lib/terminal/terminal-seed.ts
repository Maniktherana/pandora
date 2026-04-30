import type { IpcClient } from "@/services/ipc/ipc-client";

function defaultShellInfo(): { shellPath: string; shellName: string } {
  const shellPath =
    (typeof window !== "undefined"
      ? (window as typeof window & { __PANDORA_SHELL__?: string }).__PANDORA_SHELL__
      : undefined) || "/bin/zsh";
  const shellName = shellPath.split("/").pop() || "zsh";
  return { shellPath, shellName };
}

export async function seedTerminalWithName(
  client: IpcClient,
  scopeId: string,
  name?: string,
): Promise<{ slotID: string; sessionDefID: string; shellName: string }> {
  const slotID = crypto.randomUUID();
  const sessionDefID = crypto.randomUUID();
  const { shellPath } = defaultShellInfo();
  const label = name ?? "Terminal";

  await client.send(scopeId, {
    type: "create_slot",
    slot: {
      id: slotID,
      kind: "terminal_slot",
      name: label,
      autostart: true,
      presentationMode: "single",
      primarySessionDefID: sessionDefID,
      sessionDefIDs: [sessionDefID],
      persisted: false,
      sortOrder: Date.now(),
    },
  });
  await client.send(scopeId, {
    type: "create_session_def",
    session: {
      id: sessionDefID,
      slotID,
      kind: "terminal",
      name: label,
      command: `exec ${shellPath} -i`,
      cwd: null,
      port: null,
      envOverrides: {
        PANDORA_RUNTIME_ID: scopeId,
        PANDORA_SLOT_ID: slotID,
      },
      restartPolicy: "manual",
      pauseSupported: false,
      resumeSupported: false,
    },
  });
  await client.send(scopeId, { type: "open_session_instance", sessionDefID });

  return { slotID, sessionDefID, shellName: "terminal" };
}

export function seedWorkspaceTerminal(client: IpcClient, scopeId: string) {
  return seedTerminalWithName(client, scopeId, "Terminal");
}

export function seedProjectTerminal(client: IpcClient, scopeId: string) {
  return seedTerminalWithName(client, scopeId, "Terminal");
}
