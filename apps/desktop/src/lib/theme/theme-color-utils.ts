function parseRgbHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  if (h.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Linear sRGB mix: `weightFg` toward foreground, `1 - weightFg` toward background. */
export function mixHex(foreground: string, background: string, weightFg: number): string {
  const fg = parseRgbHex(foreground);
  const bg = parseRgbHex(background);
  const t = Math.max(0, Math.min(1, weightFg));
  const mix = (a: number, b: number) => Math.round(a * t + b * (1 - t));
  const r = mix(fg.r, bg.r);
  const g = mix(fg.g, bg.g);
  const b = mix(fg.b, bg.b);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** `#RRGGBB` + alpha byte (Monaco / VS Code style `#RRGGBBAA`). */
export function hexRgbAa(hex6: string, alpha01: number): string {
  const h = hex6.replace("#", "");
  if (h.length !== 6) {
    return hex6;
  }
  const a = Math.round(Math.max(0, Math.min(1, alpha01)) * 255);
  return `#${h}${a.toString(16).padStart(2, "0")}`;
}
