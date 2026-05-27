/**
 * Linear-algebra primitives — pure, allocation-light, deterministic.
 *
 * Vectors are `ReadonlyArray<number>` so the rest of the codebase
 * never mutates a shared instance. Matrices are passed as
 * `ReadonlyArray<ReadonlyArray<number>>` with explicit `rows × cols`
 * shape; the SVD / SGD in matrix-factorization.ts uses these helpers
 * directly. LinUCB uses `solveSymmetric` for its Cholesky-based
 * arm-update step.
 *
 * No native deps — the package ships pure-TS so it can be imported
 * from edge runtimes.
 */

export function dot(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length !== b.length) {
    throw new Error(`dot: length mismatch ${a.length} vs ${b.length}`);
  }
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += (a[i] as number) * (b[i] as number);
  return s;
}

export function norm(v: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i] as number;
    s += x * x;
  }
  return Math.sqrt(s);
}

export function cosine(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

export function pearson(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length !== b.length) {
    throw new Error(`pearson: length mismatch ${a.length} vs ${b.length}`);
  }
  const n = a.length;
  if (n === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i += 1) {
    sumA += a[i] as number;
    sumB += b[i] as number;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = (a[i] as number) - meanA;
    const db = (b[i] as number) - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return 0;
  return num / Math.sqrt(denA * denB);
}

export function add(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number[] {
  if (a.length !== b.length) {
    throw new Error(`add: length mismatch ${a.length} vs ${b.length}`);
  }
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = (a[i] as number) + (b[i] as number);
  return out;
}

export function scale(a: ReadonlyArray<number>, s: number): number[] {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = (a[i] as number) * s;
  return out;
}

/**
 * Solve a symmetric positive-definite linear system A x = b via
 * Cholesky decomposition. Used by LinUCB to compute θ_a = A_a^{-1} b_a
 * and the UCB variance term x^T A_a^{-1} x.
 */
export function solveSymmetric(
  A: ReadonlyArray<ReadonlyArray<number>>,
  b: ReadonlyArray<number>,
): number[] {
  const n = A.length;
  if (n === 0) return [];
  if (n !== b.length)
    throw new Error(`solveSymmetric: size mismatch ${n} vs ${b.length}`);
  for (const row of A) {
    if (row.length !== n) throw new Error('solveSymmetric: A must be square');
  }
  // Cholesky: L L^T = A, with L lower-triangular.
  const L: number[][] = [];
  for (let i = 0; i < n; i += 1) L.push(new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    const Li = L[i] as number[];
    const Ai = A[i] as ReadonlyArray<number>;
    for (let j = 0; j <= i; j += 1) {
      let sum = 0;
      const Lj = L[j] as number[];
      for (let k = 0; k < j; k += 1) sum += (Li[k] as number) * (Lj[k] as number);
      if (i === j) {
        const diag = (Ai[i] as number) - sum;
        if (diag <= 0) {
          throw new Error(
            `solveSymmetric: matrix not positive-definite (i=${i})`,
          );
        }
        Li[j] = Math.sqrt(diag);
      } else {
        Li[j] = ((Ai[j] as number) - sum) / (Lj[j] as number);
      }
    }
  }
  // Forward substitution: L y = b.
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    const Li = L[i] as number[];
    for (let k = 0; k < i; k += 1) sum += (Li[k] as number) * (y[k] as number);
    y[i] = ((b[i] as number) - sum) / (Li[i] as number);
  }
  // Backward substitution: L^T x = y.
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = 0;
    for (let k = i + 1; k < n; k += 1) {
      const Lk = L[k] as number[];
      sum += (Lk[i] as number) * (x[k] as number);
    }
    const Li = L[i] as number[];
    x[i] = ((y[i] as number) - sum) / (Li[i] as number);
  }
  return x;
}

/** Multiply a matrix A by a vector x. Rows × cols × 1 → rows × 1. */
export function matVec(
  A: ReadonlyArray<ReadonlyArray<number>>,
  x: ReadonlyArray<number>,
): number[] {
  const n = A.length;
  if (n === 0) return [];
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const row = A[i] as ReadonlyArray<number>;
    if (row.length !== x.length) throw new Error('matVec: dim mismatch');
    let s = 0;
    for (let j = 0; j < x.length; j += 1) s += (row[j] as number) * (x[j] as number);
    out[i] = s;
  }
  return out;
}
