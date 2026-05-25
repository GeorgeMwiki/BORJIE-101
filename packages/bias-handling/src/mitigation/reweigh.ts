/**
 * Pre-processing mitigation: **Reweighing**.
 * (Kamiran & Calders 2012 — "Data preprocessing techniques for
 * classification without discrimination".)
 *
 * Given a labelled training set with a binary outcome and a
 * protected attribute, attach an instance weight to each row so
 * that the joint distribution P(A, Y) matches the marginal
 * product P(A) × P(Y) — i.e. removes the spurious correlation
 * between protected attribute and label.
 *
 * Pure-function transform: returns a new array of
 * `{ ...row, weight }` rows; never mutates the input.
 *
 * Tradeoffs:
 *  - Effective only when downstream learner supports sample
 *    weights.
 *  - Does not change feature representations — bias rooted in
 *    correlated proxy features survives.
 *  - Weights can grow large for tiny strata — caller may want
 *    to cap.
 */

export interface ReweighRow {
  readonly group: string;
  readonly label: 0 | 1;
}

export interface ReweighedRow<R extends ReweighRow> {
  readonly row: R;
  readonly weight: number;
}

export function reweigh<R extends ReweighRow>(args: {
  rows: ReadonlyArray<R>;
}): ReadonlyArray<ReweighedRow<R>> {
  const n = args.rows.length;
  if (n === 0) return [];

  // Compute counts: P(A), P(Y), P(A, Y).
  const groupCounts = new Map<string, number>();
  const labelCounts: [number, number] = [0, 0];
  const jointCounts = new Map<string, [number, number]>();
  for (const r of args.rows) {
    groupCounts.set(r.group, (groupCounts.get(r.group) ?? 0) + 1);
    labelCounts[r.label] += 1;
    const slot = jointCounts.get(r.group) ?? ([0, 0] as [number, number]);
    slot[r.label] += 1;
    jointCounts.set(r.group, slot);
  }

  // Compute weights: w(a, y) = (P(A=a) * P(Y=y)) / P(A=a, Y=y).
  // Apply per-row.
  const out: ReweighedRow<R>[] = [];
  for (const r of args.rows) {
    const pA = (groupCounts.get(r.group) as number) / n;
    const pY = labelCounts[r.label] / n;
    const joint = jointCounts.get(r.group) as [number, number];
    const pAY = joint[r.label] / n;
    // If a stratum is empty pAY would be 0 — guard against div-by-zero.
    const weight = pAY === 0 ? 0 : (pA * pY) / pAY;
    out.push({ row: r, weight });
  }
  return out;
}
