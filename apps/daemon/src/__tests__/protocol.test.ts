import { describe, expect, test } from "bun:test";
import {
  createControlMessageReader,
  createOutputFrameReader,
  writeControlMessage,
  writeOutputFrame,
} from "../protocol";

describe("protocol framing", () => {
  test("reassembles length-prefixed json payloads", () => {
    const messages: unknown[] = [];
    const reader = createControlMessageReader((message) => messages.push(message));

    const payload = Buffer.from(JSON.stringify({ type: "hello", value: 42 }), "utf8");
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);

    reader(frame.subarray(0, 3));
    reader(frame.subarray(3));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "hello", value: 42 });
  });

  test("writes a single length-prefixed frame", () => {
    const writes: Buffer[] = [];
    const socket = {
      write(chunk: string | Uint8Array) {
        writes.push(Buffer.from(chunk));
        return false;
      },
    };

    const flushed = writeControlMessage(socket as never, { type: "hello", value: 42 });

    expect(flushed).toBe(false);
    expect(writes).toHaveLength(1);

    const frame = writes[0];
    const length = frame.readUInt32BE(0);
    expect(length).toBe(frame.length - 4);
    expect(JSON.parse(frame.subarray(4).toString("utf8"))).toEqual({ type: "hello", value: 42 });
  });

  test("reassembles binary output frames", () => {
    const frames: Array<{ sessionID: string; data: string }> = [];
    const reader = createOutputFrameReader((sessionID, data) => {
      frames.push({ sessionID, data: data.toString("utf8") });
    });

    const socketWrites: Buffer[] = [];
    const socket = {
      write(chunk: string | Uint8Array) {
        socketWrites.push(Buffer.from(chunk));
        return true;
      },
    };

    writeOutputFrame(socket as never, "session-1", Buffer.from("hello"));
    const frame = socketWrites[0]!;
    reader(frame.subarray(0, 6));
    reader(frame.subarray(6));

    expect(frames).toEqual([{ sessionID: "session-1", data: "hello" }]);
  });
});
