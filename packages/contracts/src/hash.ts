/**
 * Non-cryptographic FNV-1a hash for stable identifiers in simulated data,
 * parameter fingerprints and tests. Real content addressing (05 §5.1, §10.5)
 * must use a cryptographic or keyed hash; this one is not suitable for that.
 */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `sim:${h.toString(16).padStart(8, '0')}`;
}
