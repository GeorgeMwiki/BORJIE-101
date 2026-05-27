/**
 * Tied ranks (1-indexed, mid-rank ties) used by Spearman, Mann-Whitney,
 * and Kruskal-Wallis.
 */

export interface RankResult {
  readonly ranks: ReadonlyArray<number>;
  /** Σ (t^3 − t) over tie groups — used for tie correction. */
  readonly tieCorrection: number;
}

export function tiedRanks(values: ReadonlyArray<number>): RankResult {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(n).fill(0);
  let tieCorr = 0;
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && (indexed[j] as { v: number }).v === (indexed[i] as { v: number }).v) {
      j += 1;
    }
    const avgRank = (i + 1 + j) / 2; // average of ranks i+1..j
    const tieSize = j - i;
    if (tieSize > 1) {
      tieCorr += tieSize * tieSize * tieSize - tieSize;
    }
    for (let k = i; k < j; k += 1) {
      ranks[(indexed[k] as { i: number }).i] = avgRank;
    }
    i = j;
  }
  return { ranks, tieCorrection: tieCorr };
}
