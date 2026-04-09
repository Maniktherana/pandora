import { describe, expect, test } from "bun:test";
import { ProcessManager, sessionSpawnEnv } from "../process-manager";
import type { AgentCliSignal, SessionDefinition, SlotDefinition } from "../types";

function createSlot(overrides: Partial<SlotDefinition> = {}): SlotDefinition {
  return {
    id: "slot-1",
    kind: "terminal_slot",
    name: "Terminal",
    autostart: false,
    presentationMode: "single",
    primarySessionDefID: "session-def-1",
    sessionDefIDs: ["session-def-1"],
    persisted: true,
    sortOrder: 1,
    ...overrides,
  };
}

function createSessionDefinition(
  overrides: Partial<SessionDefinition> = {},
): SessionDefinition {
  return {
    id: "session-def-1",
    slotID: "slot-1",
    kind: "terminal",
    name: "Terminal",
    command: "zsh",
    cwd: "/tmp",
    port: null,
    envOverrides: {},
    restartPolicy: "manual",
    pauseSupported: false,
    resumeSupported: false,
    ...overrides,
  };
}

describe("ProcessManager updates", () => {
  test("injects Pandora hook env for restored terminal session definitions", () => {
    const env = sessionSpawnEnv(createSessionDefinition(), "runtime-1", "slot-1");

    expect(env.PANDORA_RUNTIME_ID).toBe("runtime-1");
    expect(env.PANDORA_SLOT_ID).toBe("slot-1");
    expect(env.PANDORA_HOME).toBeTruthy();
    expect(env.PATH?.split(":")[0]).toBe(`${env.PANDORA_HOME}/bin`);
  });

  test("uses updated slot names in subsequent slot state snapshots", () => {
    const manager = new ProcessManager([createSlot()], [createSessionDefinition()], () => {}, () => {});

    manager.updateSlotDefinition({ id: "slot-1", name: "API Shell" });

    expect(manager.listSlotStates()).toEqual([
      expect.objectContaining({
        id: "slot-1",
        name: "API Shell",
      }),
    ]);
  });

  test("updates stored session definitions", () => {
    const manager = new ProcessManager([createSlot()], [createSessionDefinition()], () => {}, () => {});

    manager.updateSessionDefinition({ id: "session-def-1", name: "API Shell" });

    const sessionDefinitions = (
      manager as unknown as { sessionDefinitions: Map<string, SessionDefinition> }
    ).sessionDefinitions;

    expect(sessionDefinitions.get("session-def-1")).toEqual(
      expect.objectContaining({
        id: "session-def-1",
        name: "API Shell",
      }),
    );
  });

  test("normalizes Claude and Codex CLI signals into session agent activity", () => {
    const manager = new ProcessManager([createSlot()], [createSessionDefinition()], () => {}, () => {});
    const sessions = (manager as unknown as {
      sessions: Map<
        string,
        {
          definition: SessionDefinition;
          instance: {
            id: string;
            sessionDefID: string;
            slotID: string;
            status: "running";
            pid: null;
            exitCode: null;
            startedAt: string | null;
            lastOutputAt: string | null;
            foregroundProcess: string | null;
            agentActivity: null;
          };
          process: null;
          stopTimer: null;
          fgPollTimer: null;
        }
      >;
    }).sessions;

    sessions.set("session-1", {
      definition: createSessionDefinition(),
      instance: {
        id: "session-1",
        sessionDefID: "session-def-1",
        slotID: "slot-1",
        status: "running",
        pid: null,
        exitCode: null,
        startedAt: null,
        lastOutputAt: null,
        foregroundProcess: "claude",
        agentActivity: null,
      },
      process: null,
      stopTimer: null,
      fgPollTimer: null,
    });

    const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString("base64");

    manager.recordAgentCliSignal({
      slotID: "slot-1",
      source: "claude-code",
      payloadBase64: encode({
        hook_event_name: "UserPromptSubmit",
        session_id: "claude-session-1",
      }),
    } satisfies AgentCliSignal);

    expect(manager.listSessionStates()[0]?.agentActivity).toEqual(
      expect.objectContaining({
        vendor: "claude-code",
        phase: "working",
        agentSessionID: "claude-session-1",
      }),
    );

    manager.recordAgentCliSignal({
      slotID: "slot-1",
      source: "claude-code",
      payloadBase64: encode({
        hook_event_name: "PermissionRequest",
        session_id: "claude-session-1",
      }),
    } satisfies AgentCliSignal);

    expect(manager.listSessionStates()[0]?.agentActivity).toEqual(
      expect.objectContaining({
        vendor: "claude-code",
        phase: "waiting_approval",
      }),
    );

    manager.recordAgentCliSignal({
      slotID: "slot-1",
      source: "codex",
      payloadBase64: encode({
        hook_event_name: "UserPromptSubmit",
      }),
    } satisfies AgentCliSignal);

    expect(manager.listSessionStates()[0]?.agentActivity).toEqual(
      expect.objectContaining({
        vendor: "codex",
        phase: "working",
      }),
    );

    manager.recordAgentCliSignal({
      slotID: "slot-1",
      source: "codex",
      payloadBase64: null,
    } satisfies AgentCliSignal);

    expect(manager.listSessionStates()[0]?.agentActivity).toEqual(
      expect.objectContaining({
        vendor: "codex",
        phase: "finished",
      }),
    );
  });
});
