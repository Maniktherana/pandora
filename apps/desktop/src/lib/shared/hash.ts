export const FNV1A_32_OFFSET_BASIS = 2166136261;
export const FNV1A_32_PRIME = 16777619;

/** Stable FNV-1a 32-bit text hash used for diff and editor cache keys. */
export function hashDiffText(value: string): string {
  let hash = FNV1A_32_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV1A_32_PRIME);
  }
  return (hash >>> 0).toString(36);
}
