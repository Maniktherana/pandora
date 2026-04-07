import type { DaemonClient } from "../runtime/daemon-client";

function defaultShellInfo(): { shellPath: string; shellName: string } {
  const shellPath =
    (typeof window !== "undefined" ? (window as typeof window & { __PANDORA_SHELL__?: string }).__PANDORA_SHELL__ : undefined) ||
    "/bin/zsh";
  const shellName = shellPath.split("/").pop() || "zsh";
  return { shellPath, shellName };
}

export function seedTerminalWithName(client: DaemonClient, runtimeId: string, name?: string) {
  const slotID = crypto.randomUUID();
  const sessionDefID = crypto.randomUUID();
  const { shellPath } = defaultShellInfo();
  const label = name ?? "Terminal";

  void client.send(runtimeId, {
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
  }).then(() =>
    client.send(runtimeId, {
      type: "create_session_def",
      session: {
        id: sessionDefID,
        slotID,
        kind: "terminal",
        name: label,
        command: `exec ${shellPath} -i`,
        cwd: null,
        port: null,
        envOverrides: {},
        restartPolicy: "manual",
        pauseSupported: false,
        resumeSupported: false,
      },
    })
  ).then(() => client.openSessionInstance(runtimeId, sessionDefID));

  return { slotID, sessionDefID, shellName: "terminal" };
}

export function seedWorkspaceTerminal(client: DaemonClient, runtimeId: string) {
  return seedTerminalWithName(client, runtimeId, "Terminal");
}

export function seedProjectTerminal(client: DaemonClient, runtimeId: string) {
  return seedTerminalWithName(client, runtimeId, "Terminal");
}
