/**
 * Pure scoring helpers used by `resolveEntity`. Kept separate so the
 * scorer is swappable without touching the orchestrator. All functions
 * are deterministic and side-effect free.
 */

/**
 * Cosine similarity of two equal-length vectors. Returns 0 for empty
 * inputs (preferable to throwing — the orchestrator collapses missing
 * embeddings to 0 weight rather than aborting).
 */
export function cosineSimilarity(
  a: ReadonlyArray<number> | undefined,
  b: ReadonlyArray<number> | undefined,
): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] as number;
    const bv = b[i] as number;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Levenshtein edit distance. O(n*m) DP, sufficient for short identity
 * strings (names, emails). Returns Infinity for nullish inputs.
 */
export function levenshtein(a: string | undefined, b: string | undefined): number {
  if (a == null || b == null) {
    return Number.POSITIVE_INFINITY;
  }
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = new Array(b.length + 1);
  let curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const del = (prev[j] as number) + 1;
      const ins = (curr[j - 1] as number) + 1;
      const sub = (prev[j - 1] as number) + cost;
      curr[j] = Math.min(del, ins, sub);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length] as number;
}

/** Normalized Levenshtein in [0..1] where 1 means equal. */
export function levenshteinSimilarity(
  a: string | undefined,
  b: string | undefined,
): number {
  if (a == null || b == null) return 0;
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  if (!Number.isFinite(dist)) return 0;
  return 1 - dist / Math.max(a.length, b.length);
}

/**
 * Jaro–Winkler similarity in [0..1]. Heavier weight on common prefixes
 * — well-suited to personal names and email locals. Standard parameter
 * p=0.1 with prefix length capped at 4.
 */
export function jaroWinkler(a: string | undefined, b: string | undefined): number {
  if (a == null || b == null) return 0;
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches: boolean[] = new Array(a.length).fill(false);
  const bMatches: boolean[] = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  transpositions /= 2;
  const jaro =
    (matches / a.length +
      matches / b.length +
      (matches - transpositions) / matches) /
    3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] !== b[i]) break;
    prefix += 1;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Combine Levenshtein + Jaro–Winkler into a single fuzzy-string signal
 * weighted toward Jaro–Winkler (better for short identity strings).
 */
export function fuzzyStringSimilarity(
  a: string | undefined,
  b: string | undefined,
): number {
  const lev = levenshteinSimilarity(a, b);
  const jw = jaroWinkler(a, b);
  return 0.4 * lev + 0.6 * jw;
}

/**
 * Normalize an identifier (email / phone) for structural comparison.
 * - Lowercases
 * - Strips whitespace
 * - Strips common phone punctuation
 */
export function normalizeIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  return trimmed.replace(/[\s().+\-]/g, '');
}
