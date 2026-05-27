/**
 * Mode — the most frequent value(s). Returns ALL values tied at the
 * maximum frequency, sorted ascending. For a strictly continuous vector
 * with all-unique values, returns the entire (sorted) vector — by
 * definition every value is a mode.
 */

export function mode(values: ReadonlyArray<number>): ReadonlyArray<number> {
  if (values.length === 0) {
    throw new Error('mode: cannot compute mode of empty vector');
  }
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let max = 0;
  for (const c of counts.values()) {
    if (c > max) max = c;
  }
  const modes: number[] = [];
  for (const [v, c] of counts.entries()) {
    if (c === max) modes.push(v);
  }
  return modes.sort((a, b) => a - b);
}
