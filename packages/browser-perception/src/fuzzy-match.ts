/**
 * Jaro-Winkler string similarity — the fuzzy matcher behind the driver's
 * action-resolution fallback chain.
 *
 * When a legacy portal renames a control ("KRA PIN" → "KRA PIN Number")
 * the exact a11y lookup misses. Jaro-Winkler scores prefix-sharing
 * strings highly, so the driver can still resolve the control at a
 * known confidence rather than bare-failing. Returns a score in [0,1];
 * 1.0 means identical.
 */

/** Base Jaro similarity in [0,1]. */
export function jaroSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0 || bLen === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(aLen, bLen) / 2) - 1);
  const aMatches = new Array<boolean>(aLen).fill(false);
  const bMatches = new Array<boolean>(bLen).fill(false);

  let matches = 0;
  for (let i = 0; i < aLen; i += 1) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, bLen);
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

  // Count transpositions.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < aLen; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  transpositions = Math.floor(transpositions / 2);

  const m = matches;
  return (m / aLen + m / bLen + (m - transpositions) / m) / 3;
}

/**
 * Jaro-Winkler — boosts the base Jaro score for strings sharing a common
 * prefix (up to 4 chars), which is exactly the "control got a suffix
 * added" rename pattern.
 */
export function jaroWinklerSimilarity(
  a: string,
  b: string,
  prefixScale = 0.1,
): number {
  const jaro = jaroSimilarity(a, b);
  if (jaro === 0) return 0;

  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  for (let i = 0; i < maxPrefix; i += 1) {
    if (a[i] === b[i]) prefix += 1;
    else break;
  }

  return jaro + prefix * prefixScale * (1 - jaro);
}
