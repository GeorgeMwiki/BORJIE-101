/**
 * Isolation Forest (iForest).
 *
 * Pure-TypeScript port of Liu, F. T., Ting, K. M., & Zhou, Z.-H. (2008).
 * *Isolation Forest.* IEEE ICDM 2008. DOI: 10.1109/ICDM.2008.17.
 *
 * Anomaly score:
 *
 *   s(x, n) = 2^(−E(h(x)) / c(n))
 *
 * where `h(x)` is the path length to isolate `x` in a single tree,
 * `E(h(x))` is the average over the forest, and
 *
 *   c(n) = 2 · H(n − 1) − 2(n − 1) / n
 *
 * is the average path length of an unsuccessful BST search on `n`
 * points. `H(i) ≈ ln(i) + 0.5772156649` (Euler-Mascheroni).
 *
 * Scoring convention: `s ∈ (0, 1)`, with higher = more anomalous.
 * Threshold defaults to 0.5 (per the paper).
 *
 * Determinism: the internal PRNG is seeded; reseed for repeatability.
 *
 * @module @borjie/anomaly-detection/detectors/isolation-forest
 */

import { createSeededRng, type SeededRng } from '../__fixtures__/seeded-rng.js';
import type { AnomalyScore, IsolationForestConfig } from '../types.js';

const DEFAULT_N_TREES = 100;
const DEFAULT_PSI = 256;
const DEFAULT_THRESHOLD = 0.5;
const DEFAULT_SEED = 1337;
const EULER_MASCHERONI = 0.5772156649015329;

// ──────────────────────────────────────────────────────────────────
// Tree node shape — discriminated union, all frozen.
// ──────────────────────────────────────────────────────────────────

interface IForestLeaf {
  readonly kind: 'leaf';
  readonly size: number;
}

interface IForestSplit {
  readonly kind: 'split';
  readonly feature: number;
  readonly value: number;
  readonly left: IForestNode;
  readonly right: IForestNode;
}

type IForestNode = IForestLeaf | IForestSplit;

export interface IsolationForestModel {
  readonly trees: ReadonlyArray<IForestNode>;
  readonly psi: number;
  readonly cPsi: number;
  readonly dimensions: number;
  readonly threshold: number;
}

// ──────────────────────────────────────────────────────────────────
// Average path-length normaliser.
// ──────────────────────────────────────────────────────────────────

/**
 * Average unsuccessful-BST path length on `n` points.
 * Liu et al. 2008 eq. (1).
 */
export function averagePathLength(n: number): number {
  if (n <= 1) return 0;
  const h = Math.log(n - 1) + EULER_MASCHERONI;
  return 2 * h - (2 * (n - 1)) / n;
}

// ──────────────────────────────────────────────────────────────────
// Tree construction.
// ──────────────────────────────────────────────────────────────────

function buildTree(
  sample: ReadonlyArray<ReadonlyArray<number>>,
  currentDepth: number,
  heightLimit: number,
  rng: SeededRng,
): IForestNode {
  if (currentDepth >= heightLimit || sample.length <= 1) {
    return Object.freeze({ kind: 'leaf' as const, size: sample.length });
  }
  const dimensions = sample[0]!.length;
  // Random feature axis.
  const feature = Math.floor(rng.next() * dimensions);
  let min = Infinity;
  let max = -Infinity;
  for (const row of sample) {
    const v = row[feature]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) {
    return Object.freeze({ kind: 'leaf' as const, size: sample.length });
  }
  const splitValue = min + rng.next() * (max - min);
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i]![feature]! < splitValue) {
      left.push(i);
    } else {
      right.push(i);
    }
  }
  return Object.freeze({
    kind: 'split' as const,
    feature,
    value: splitValue,
    left: buildTree(
      left.map((i) => sample[i]!),
      currentDepth + 1,
      heightLimit,
      rng,
    ),
    right: buildTree(
      right.map((i) => sample[i]!),
      currentDepth + 1,
      heightLimit,
      rng,
    ),
  });
}

function subSample(
  data: ReadonlyArray<ReadonlyArray<number>>,
  psi: number,
  rng: SeededRng,
): ReadonlyArray<ReadonlyArray<number>> {
  const m = Math.min(psi, data.length);
  // Fisher-Yates partial shuffle to draw `m` without replacement.
  const indices: number[] = [];
  for (let i = 0; i < data.length; i += 1) indices.push(i);
  for (let i = 0; i < m; i += 1) {
    const j = i + Math.floor(rng.next() * (data.length - i));
    const tmp = indices[i]!;
    indices[i] = indices[j]!;
    indices[j] = tmp;
  }
  const out: ReadonlyArray<number>[] = [];
  for (let i = 0; i < m; i += 1) {
    out.push(data[indices[i]!]!);
  }
  return out;
}

/**
 * Train an iForest model on `data`.
 *
 * `data` is an `n × d` row-major matrix. The pure-univariate case
 * (`d = 1`) is supported — pass `[[x_0], [x_1], …]`.
 */
export function fitIsolationForest(
  data: ReadonlyArray<ReadonlyArray<number>>,
  config: IsolationForestConfig = {},
): IsolationForestModel {
  if (data.length === 0) {
    throw new Error('fitIsolationForest: empty training set');
  }
  const dims = data[0]!.length;
  for (const row of data) {
    if (row.length !== dims) {
      throw new Error('fitIsolationForest: inconsistent row dimensions');
    }
  }
  const nTrees = config.nTrees ?? DEFAULT_N_TREES;
  const psi = config.psi ?? DEFAULT_PSI;
  const seed = config.seed ?? DEFAULT_SEED;
  const threshold = config.threshold ?? DEFAULT_THRESHOLD;
  const heightLimit = Math.ceil(Math.log2(Math.max(2, Math.min(psi, data.length))));
  const rng = createSeededRng(seed);
  const trees: IForestNode[] = [];
  for (let t = 0; t < nTrees; t += 1) {
    const sample = subSample(data, psi, rng);
    trees.push(buildTree(sample, 0, heightLimit, rng));
  }
  const effectivePsi = Math.min(psi, data.length);
  return Object.freeze({
    trees,
    psi: effectivePsi,
    cPsi: averagePathLength(effectivePsi),
    dimensions: dims,
    threshold,
  });
}

// ──────────────────────────────────────────────────────────────────
// Path length on a fitted tree.
// ──────────────────────────────────────────────────────────────────

function pathLength(node: IForestNode, point: ReadonlyArray<number>): number {
  let depth = 0;
  let current: IForestNode = node;
  while (current.kind === 'split') {
    depth += 1;
    if (point[current.feature]! < current.value) {
      current = current.left;
    } else {
      current = current.right;
    }
  }
  return depth + averagePathLength(current.size);
}

// ──────────────────────────────────────────────────────────────────
// Scoring.
// ──────────────────────────────────────────────────────────────────

/**
 * Score a single point against a fitted model.
 *
 * The returned `AnomalyScore.value` is the **first component** of the
 * point (a domain-meaningful scalar may be supplied via `valueOverride`).
 */
export function scoreIsolationForest(
  model: IsolationForestModel,
  point: ReadonlyArray<number>,
  valueOverride?: number,
): AnomalyScore {
  if (point.length !== model.dimensions) {
    throw new Error(
      `scoreIsolationForest: dimension mismatch (model ${model.dimensions}, point ${point.length})`,
    );
  }
  let total = 0;
  for (const tree of model.trees) {
    total += pathLength(tree, point);
  }
  const meanPath = total / model.trees.length;
  // s(x, n) = 2 ** (-meanPath / cPsi)
  const score = Math.pow(2, -meanPath / model.cPsi);
  return Object.freeze({
    value: valueOverride ?? point[0]!,
    score,
    scoreKind: 'iforest' as const,
    threshold: model.threshold,
    anomalous: score >= model.threshold,
  });
}

/**
 * Convenience: fit and score in one call. Returns per-row scores in
 * input order. The training set is the input itself, mirroring sklearn's
 * `IsolationForest.fit_predict`.
 */
export function detectIsolationForestAnomalies(
  data: ReadonlyArray<ReadonlyArray<number>>,
  config: IsolationForestConfig = {},
): ReadonlyArray<AnomalyScore> {
  const model = fitIsolationForest(data, config);
  return data.map((row) => scoreIsolationForest(model, row));
}
