import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonServer } from "../daemon";

describe("daemon socket backpressure", () => {
  test("skips output frames for draining data clients but still sends control updates", async () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "pandora-daemon-test-"));
    const previousPandoraHome = process.env.PANDORA_HOME;
    process.env.PANDORA_HOME = workspacePath;
    const server = new DaemonServer(workspacePath);

    try {
      const controlWrites: { type: string }[] = [];
      const fastFrames: Array<{ sessionID: string; data: string }> = [];
      const slowFrames: Array<{ sessionID: string; data: string }> = [];
      const controlSocket = {
        write(chunk: string | Uint8Array) {
          const frame = Buffer.from(chunk);
          controlWrites.push(JSON.parse(frame.subarray(4).toString("utf8")));
          return true;
        },
        destroy() {},
      };
      const fastSocket = {
        write(chunk: string | Uint8Array) {
          const frame = Buffer.from(chunk);
          const sessionLength = frame.readUInt8(4);
          const sessionID = frame.subarray(5, 5 + sessionLength).toString("utf8");
          const data = frame.subarray(5 + sessionLength).toString("utf8");
          fastFrames.push({ sessionID, data });
          return true;
        },
        destroy() {},
      };
      const slowSocket = {
        write(chunk: string | Uint8Array) {
          const frame = Buffer.from(chunk);
          const sessionLength = frame.readUInt8(4);
          const sessionID = frame.subarray(5, 5 + sessionLength).toString("utf8");
          const data = frame.subarray(5 + sessionLength).toString("utf8");
          slowFrames.push({ sessionID, data });
          return false;
        },
        destroy() {},
      };

      const internal = server as never as {
        controlClients: Set<object>;
        dataClients: Map<object, { socket: object; draining: boolean }>;
        broadcastControl(message: { type: string }): void;
        broadcastOutput(sessionID: string, data: Buffer): void;
      };

      internal.controlClients.add(controlSocket);
      internal.dataClients.set(fastSocket, { socket: fastSocket, draining: false });
      internal.dataClients.set(slowSocket, { socket: slowSocket, draining: false });

      internal.broadcastOutput("s1", Buffer.from("A"));
      internal.broadcastOutput("s1", Buffer.from("B"));
      internal.broadcastControl({ type: "session_snapshot" });

      expect(fastFrames).toEqual([
        { sessionID: "s1", data: "A" },
        { sessionID: "s1", data: "B" },
      ]);
      expect(slowFrames).toEqual([{ sessionID: "s1", data: "A" }]);
      expect(controlWrites.map((message) => message.type)).toEqual(["session_snapshot"]);
      expect(internal.dataClients.get(slowSocket)?.draining).toBe(true);
    } finally {
      await server.stop();
      if (previousPandoraHome === undefined) {
        delete process.env.PANDORA_HOME;
      } else {
        process.env.PANDORA_HOME = previousPandoraHome;
      }
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  test("skips output chunk broadcasts entirely when every client is draining", async () => {
    const workspacePath = mkdtempSync(path.join(tmpdir(), "pandora-daemon-test-"));
    const previousPandoraHome = process.env.PANDORA_HOME;
    process.env.PANDORA_HOME = workspacePath;
    const server = new DaemonServer(workspacePath);

    try {
      const writes: Array<{ sessionID: string; data: string }> = [];
      const slowSocketA = {
        write(chunk: string | Uint8Array) {
          const frame = Buffer.from(chunk);
          const sessionLength = frame.readUInt8(4);
          const sessionID = frame.subarray(5, 5 + sessionLength).toString("utf8");
          const data = frame.subarray(5 + sessionLength).toString("utf8");
          writes.push({ sessionID, data });
          return false;
        },
        destroy() {},
      };
      const slowSocketB = {
        write(chunk: string | Uint8Array) {
          const frame = Buffer.from(chunk);
          const sessionLength = frame.readUInt8(4);
          const sessionID = frame.subarray(5, 5 + sessionLength).toString("utf8");
          const data = frame.subarray(5 + sessionLength).toString("utf8");
          writes.push({ sessionID, data });
          return false;
        },
        destroy() {},
      };

      const internal = server as never as {
        allClientsDraining: boolean;
        dataClients: Map<object, { socket: object; draining: boolean }>;
        broadcastOutput(sessionID: string, data: Buffer): void;
        updateAllClientsDraining(): void;
      };

      internal.dataClients.set(slowSocketA, { socket: slowSocketA, draining: false });
      internal.dataClients.set(slowSocketB, { socket: slowSocketB, draining: false });

      internal.broadcastOutput("s1", Buffer.from("A"));
      internal.updateAllClientsDraining();

      expect(internal.allClientsDraining).toBe(true);
      expect(writes).toEqual([
        { sessionID: "s1", data: "A" },
        { sessionID: "s1", data: "A" },
      ]);

      internal.broadcastOutput("s1", Buffer.from("B"));
      expect(writes).toEqual([
        { sessionID: "s1", data: "A" },
        { sessionID: "s1", data: "A" },
      ]);
    } finally {
      await server.stop();
      if (previousPandoraHome === undefined) {
        delete process.env.PANDORA_HOME;
      } else {
        process.env.PANDORA_HOME = previousPandoraHome;
      }
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });
});
