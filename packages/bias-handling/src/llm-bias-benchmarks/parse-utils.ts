/**
 * Tiny utilities for parsing LLM replies — kept here to avoid
 * bringing in a markdown / regex library.
 */

/**
 * Pull the first digit in the reply that maps to a valid choice
 * index (0..n-1). Returns -1 if none found.
 */
export function parseChoiceIndex(reply: string, n: number): number {
  for (let i = 0; i < reply.length; i++) {
    const c = reply[i]!;
    const digit = c.charCodeAt(0) - 48;
    if (digit >= 0 && digit < n) return digit;
  }
  return -1;
}

/**
 * Returns true if the reply contains any of the given keywords
 * (case-insensitive substring match).
 */
export function containsAnyKeyword(
  reply: string,
  keywords: ReadonlyArray<string>,
): boolean {
  const r = reply.toLowerCase();
  for (const k of keywords) {
    if (r.includes(k.toLowerCase())) return true;
  }
  return false;
}
