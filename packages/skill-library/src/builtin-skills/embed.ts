/**
 * Deterministic 16-dim "embedding" used by the 6 built-in skills.
 *
 * NOT a real embedder. We hash characters into 16 buckets, weight by
 * (charcode % 7) - 3 to keep the vector in a reasonable range, then
 * L2-normalise. Real production wires a real embedding API; this keeps
 * the package zero-runtime-dependency.
 *
 * The function is pure and deterministic — same text always returns the
 * same vector. That's what tests need.
 */

const DIM = 16;

export function embed(text: string): ReadonlyArray<number> {
  const out: Array<number> = new Array(DIM).fill(0);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const bucket = c % DIM;
    const weight = ((c % 7) - 3) / 10;
    out[bucket] = (out[bucket] ?? 0) + weight;
  }
  const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return out;
  return out.map((v) => v / norm);
}
