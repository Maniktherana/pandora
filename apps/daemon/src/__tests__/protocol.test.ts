import { describe, expect, test } from "bun:test";
import { createMessageReader } from "../protocol";

describe("protocol framing", () => {
  test("reassembles length-prefixed json payloads", () => {
    const messages: unknown[] = [];
    const reader = createMessageReader((message) => messages.push(message));

    const payload = Buffer.from(JSON.stringify({ type: "hello", value: 42 }), "utf8");
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32BE(payload.length, 0);
    payload.copy(frame, 4);

    reader(frame.subarray(0, 3));
    reader(frame.subarray(3));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ type: "hello", value: 42 });
  });
});
