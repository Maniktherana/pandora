import { describe, expect, it } from "bun:test";
import { getFontZoomDirection } from "./use-keyboard-shortcuts";

describe("getFontZoomDirection", () => {
  it("treats command-plus keys as zoom in", () => {
    expect(getFontZoomDirection({ key: "+", metaKey: true })).toBe(1);
    expect(getFontZoomDirection({ key: "=", metaKey: true })).toBe(1);
  });

  it("treats command-minus keys as zoom out", () => {
    expect(getFontZoomDirection({ key: "-", metaKey: true })).toBe(-1);
    expect(getFontZoomDirection({ key: "_", metaKey: true })).toBe(-1);
  });

  it("ignores unrelated modifier combos", () => {
    expect(getFontZoomDirection({ key: "+", metaKey: false, ctrlKey: false })).toBeNull();
    expect(getFontZoomDirection({ key: "+", metaKey: true, altKey: true })).toBeNull();
    expect(getFontZoomDirection({ key: "a", metaKey: true })).toBeNull();
  });
});
