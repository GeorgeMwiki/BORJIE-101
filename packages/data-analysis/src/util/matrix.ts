/**
 * Minimal matrix primitives used by regression and PCA.
 *
 * Pure-TS, immutable, no native bindings. We avoid pulling in ml-matrix
 * because we only need:
 *   - transpose
 *   - matMul
 *   - matVec
 *   - identity
 *   - LU-decomposition solve (Gauss-Jordan with partial pivoting)
 *   - symmetric eigendecomposition (Jacobi rotations)
 *
 * That's enough for OLS, polynomial fit, and PCA on the input sizes
 * Mr. Mwikila's working sets produce (up to ~1000 × 50).
 */

export type Matrix = ReadonlyArray<ReadonlyArray<number>>;

export function zeros(rows: number, cols: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < rows; i += 1) {
    out.push(new Array<number>(cols).fill(0));
  }
  return out;
}

export function identity(n: number): number[][] {
  const m = zeros(n, n);
  for (let i = 0; i < n; i += 1) {
    (m[i] as number[])[i] = 1;
  }
  return m;
}

export function transpose(a: Matrix): number[][] {
  const rows = a.length;
  const cols = (a[0] as ReadonlyArray<number>).length;
  const out = zeros(cols, rows);
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      (out[j] as number[])[i] = (a[i] as ReadonlyArray<number>)[j] as number;
    }
  }
  return out;
}

export function matMul(a: Matrix, b: Matrix): number[][] {
  const ar = a.length;
  const ac = (a[0] as ReadonlyArray<number>).length;
  const br = b.length;
  const bc = (b[0] as ReadonlyArray<number>).length;
  if (ac !== br) {
    throw new Error(`matMul: incompatible shapes ${ar}x${ac} · ${br}x${bc}`);
  }
  const out = zeros(ar, bc);
  for (let i = 0; i < ar; i += 1) {
    const row = a[i] as ReadonlyArray<number>;
    const outRow = out[i] as number[];
    for (let k = 0; k < ac; k += 1) {
      const aik = row[k] as number;
      if (aik === 0) continue;
      const bk = b[k] as ReadonlyArray<number>;
      for (let j = 0; j < bc; j += 1) {
        outRow[j] = (outRow[j] as number) + aik * (bk[j] as number);
      }
    }
  }
  return out;
}

export function matVec(a: Matrix, x: ReadonlyArray<number>): number[] {
  const rows = a.length;
  const cols = (a[0] as ReadonlyArray<number>).length;
  if (cols !== x.length) {
    throw new Error(`matVec: incompatible shapes ${rows}x${cols} · ${x.length}`);
  }
  const out = new Array<number>(rows).fill(0);
  for (let i = 0; i < rows; i += 1) {
    const row = a[i] as ReadonlyArray<number>;
    let s = 0;
    for (let j = 0; j < cols; j += 1) {
      s += (row[j] as number) * (x[j] as number);
    }
    out[i] = s;
  }
  return out;
}

/**
 * Solve A x = b for square A via Gauss-Jordan with partial pivoting.
 * Mutates a working copy; returns x.
 */
export function solveLinearSystem(
  a: Matrix,
  b: ReadonlyArray<number>,
): number[] {
  const n = a.length;
  if (b.length !== n) {
    throw new Error('solveLinearSystem: b length must equal A rows');
  }
  // Build augmented [A | b]
  const aug: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row = a[i] as ReadonlyArray<number>;
    if (row.length !== n) {
      throw new Error('solveLinearSystem: A must be square');
    }
    aug.push([...row, b[i] as number]);
  }
  for (let col = 0; col < n; col += 1) {
    // Partial pivot
    let pivot = col;
    let pivotVal = Math.abs((aug[col] as number[])[col] as number);
    for (let r = col + 1; r < n; r += 1) {
      const v = Math.abs((aug[r] as number[])[col] as number);
      if (v > pivotVal) {
        pivot = r;
        pivotVal = v;
      }
    }
    if (pivotVal < 1e-14) {
      throw new Error('solveLinearSystem: matrix is singular or nearly so');
    }
    if (pivot !== col) {
      const tmp = aug[col] as number[];
      aug[col] = aug[pivot] as number[];
      aug[pivot] = tmp;
    }
    // Eliminate
    const pivotRow = aug[col] as number[];
    const pv = pivotRow[col] as number;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const rowR = aug[r] as number[];
      const factor = (rowR[col] as number) / pv;
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) {
        rowR[c] = (rowR[c] as number) - factor * (pivotRow[c] as number);
      }
    }
  }
  const x = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const row = aug[i] as number[];
    x[i] = (row[n] as number) / (row[i] as number);
  }
  return x;
}

/**
 * Symmetric eigendecomposition via cyclic Jacobi rotations.
 * Returns eigenvalues sorted descending and the matching eigenvectors
 * as the columns of `vectors`.
 */
export interface EigResult {
  readonly values: ReadonlyArray<number>;
  readonly vectors: Matrix;   // columns are eigenvectors
}

export function symmetricEig(a: Matrix, maxIter: number = 200): EigResult {
  const n = a.length;
  // Working copy
  const A: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    A.push([...(a[i] as ReadonlyArray<number>)]);
  }
  const V = identity(n);
  for (let iter = 0; iter < maxIter; iter += 1) {
    // Find largest off-diagonal
    let p = 0;
    let q = 1;
    let max = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const v = Math.abs((A[i] as number[])[j] as number);
        if (v > max) {
          max = v;
          p = i;
          q = j;
        }
      }
    }
    if (max < 1e-12) break;
    const app = (A[p] as number[])[p] as number;
    const aqq = (A[q] as number[])[q] as number;
    const apq = (A[p] as number[])[q] as number;
    const theta = (aqq - app) / (2 * apq);
    const t =
      theta === 0
        ? 1
        : Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    // Update A
    (A[p] as number[])[p] = app - t * apq;
    (A[q] as number[])[q] = aqq + t * apq;
    (A[p] as number[])[q] = 0;
    (A[q] as number[])[p] = 0;
    for (let i = 0; i < n; i += 1) {
      if (i !== p && i !== q) {
        const aip = (A[i] as number[])[p] as number;
        const aiq = (A[i] as number[])[q] as number;
        (A[i] as number[])[p] = c * aip - s * aiq;
        (A[p] as number[])[i] = (A[i] as number[])[p] as number;
        (A[i] as number[])[q] = c * aiq + s * aip;
        (A[q] as number[])[i] = (A[i] as number[])[q] as number;
      }
    }
    for (let i = 0; i < n; i += 1) {
      const vip = (V[i] as number[])[p] as number;
      const viq = (V[i] as number[])[q] as number;
      (V[i] as number[])[p] = c * vip - s * viq;
      (V[i] as number[])[q] = c * viq + s * vip;
    }
  }
  // Extract eigenvalues + sort descending
  const indices = new Array<number>(n);
  const values = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    indices[i] = i;
    values[i] = (A[i] as number[])[i] as number;
  }
  indices.sort((a1, b1) => (values[b1] as number) - (values[a1] as number));
  const sortedVals: number[] = [];
  const sortedVecs: number[][] = zeros(n, n);
  for (let j = 0; j < n; j += 1) {
    const srcCol = indices[j] as number;
    sortedVals.push(values[srcCol] as number);
    for (let i = 0; i < n; i += 1) {
      (sortedVecs[i] as number[])[j] = (V[i] as number[])[srcCol] as number;
    }
  }
  return { values: sortedVals, vectors: sortedVecs };
}
