/**
 * Per-(tenant, route) query-embedding drift detector.
 *
 * Each (tenantId, route) pair owns:
 *   - a Welford online mean + M2 (variance accumulator) over the
 *     *cosine distance of each query to the centroid of prior queries*,
 *   - a ring buffer of the last `RING_BUFFER_SIZE` embeddings for the
 *     centroid + stdev window,
 *   - the most recent sample's distance to the centroid.
 *
 * Drift signal:
 *     isDrifting = |lastSampleDistance − mean| > 2 · std
 *
 * Welford's algorithm (Welford 1962, popularised by Knuth TAOCP vol. 2
 * §4.2.2) is used for the streaming statistics because the naive
 * sum-of-squares formula loses precision after ~10⁴ samples on f64.
 *
 * The detector is pure logic + an optional persistence port — the port
 * is declared but NOT implemented here (database-backed snapshot belongs
 * in `@borjie/database`). For now state lives in a `Map` on the
 * `DriftDetector` instance, surviving the process lifetime only.
 *
 * Immutability note: `recordQuery` accepts a `ReadonlyArray<number>`
 * and does NOT mutate the caller's input. The internal ring buffer
 * stores a defensive copy.
 */

/** Buffer size per (tenantId, route). Bounded so memory stays O(1) per route. */
export const RING_BUFFER_SIZE = 100;

/** Drift threshold expressed as a multiple of σ from the running mean. */
export const DRIFT_SIGMA_THRESHOLD = 2;

/** Signal surface returned from `getDriftSignal`. */
export interface DriftSignal {
  readonly mean: number;
  readonly std: number;
  readonly lastSampleDistance: number;
  readonly isDrifting: boolean;
  readonly sampleCount: number;
}

/**
 * Optional persistence port. The detector survives process restarts iff
 * the host wires this up — adapter goes in `@borjie/database`. The
 * port is intentionally read-only to keep migration concerns out of the
 * kernel.
 */
export interface DriftPersistencePort {
  load(args: {
    readonly tenantId: string;
    readonly route: string;
  }): Promise<DriftStateSnapshot | null>;
  save(args: {
    readonly tenantId: string;
    readonly route: string;
    readonly snapshot: DriftStateSnapshot;
  }): Promise<void>;
}

/** Serialisable snapshot of one (tenantId, route) bucket. */
export interface DriftStateSnapshot {
  readonly mean: number;
  readonly m2: number;
  readonly count: number;
  /** Most recent N embeddings — preserved for centroid math after restart. */
  readonly window: ReadonlyArray<ReadonlyArray<number>>;
  readonly lastSampleDistance: number;
}

interface BucketState {
  mean: number;
  m2: number;
  count: number;
  window: number[][];
  lastSampleDistance: number;
}

/**
 * In-memory implementation. Use the singleton via `recordQuery` /
 * `getDriftSignal` exports, or instantiate directly in tests / DI.
 */
export class DriftDetector {
  private readonly buckets = new Map<string, BucketState>();

  /**
   * Record one query embedding. Updates the centroid window, computes
   * cosine distance to the *prior* centroid (so the first sample's
   * distance is 0), and folds that distance into the Welford running
   * statistics.
   *
   * Input embedding is treated as read-only — a copy is stored.
   */
  recordQuery(
    tenantId: string,
    route: string,
    embedding: ReadonlyArray<number>,
  ): void {
    if (typeof tenantId !== 'string' || tenantId.length === 0) return;
    if (typeof route !== 'string' || route.length === 0) return;
    if (!Array.isArray(embedding) || embedding.length === 0) return;

    const key = bucketKey(tenantId, route);
    const state = this.buckets.get(key) ?? createBucket();

    // Distance of *this* sample to the centroid computed from *prior*
    // entries — so the very first sample is distance 0.
    const priorCentroid = computeCentroid(state.window);
    const distance =
      priorCentroid === null ? 0 : 1 - cosine(embedding, priorCentroid);

    // Defensive copy — caller's array stays untouched.
    const copy = embedding.slice();
    state.window.push(copy);
    if (state.window.length > RING_BUFFER_SIZE) {
      state.window.shift();
    }

    // Welford update on the *distance* (scalar) — high numerical
    // stability vs the naive sum-of-squares approach.
    state.count += 1;
    const delta = distance - state.mean;
    state.mean += delta / state.count;
    const delta2 = distance - state.mean;
    state.m2 += delta * delta2;
    state.lastSampleDistance = distance;

    this.buckets.set(key, state);
  }

  /**
   * Read the drift signal for one (tenantId, route). Returns zeros
   * when the bucket has never been written. `isDrifting` is false
   * until at least 2 samples have been recorded — std is undefined
   * for n < 2.
   */
  getDriftSignal(tenantId: string, route: string): DriftSignal {
    const state = this.buckets.get(bucketKey(tenantId, route));
    if (!state || state.count < 2) {
      return {
        mean: state?.mean ?? 0,
        std: 0,
        lastSampleDistance: state?.lastSampleDistance ?? 0,
        isDrifting: false,
        sampleCount: state?.count ?? 0,
      };
    }
    // Population variance = M2 / n; sample variance = M2 / (n-1).
    // We use sample variance — drift detection is more conservative
    // when the population is unknown / streaming.
    const variance = state.m2 / (state.count - 1);
    const std = variance > 0 ? Math.sqrt(variance) : 0;
    const isDrifting =
      std > 0 &&
      Math.abs(state.lastSampleDistance - state.mean) >
        DRIFT_SIGMA_THRESHOLD * std;
    return {
      mean: state.mean,
      std,
      lastSampleDistance: state.lastSampleDistance,
      isDrifting,
      sampleCount: state.count,
    };
  }

  /**
   * Export the bucket's snapshot — useful for the persistence port.
   * Returns `null` if the bucket has never been touched.
   */
  snapshot(tenantId: string, route: string): DriftStateSnapshot | null {
    const state = this.buckets.get(bucketKey(tenantId, route));
    if (!state) return null;
    return {
      mean: state.mean,
      m2: state.m2,
      count: state.count,
      window: state.window.map((v) => v.slice()),
      lastSampleDistance: state.lastSampleDistance,
    };
  }

  /**
   * Restore a previously-persisted snapshot. The bucket is reset
   * verbatim — caller is responsible for choosing the right snapshot
   * for the (tenantId, route) pair.
   */
  restore(
    tenantId: string,
    route: string,
    snapshot: DriftStateSnapshot,
  ): void {
    if (typeof tenantId !== 'string' || tenantId.length === 0) return;
    if (typeof route !== 'string' || route.length === 0) return;
    this.buckets.set(bucketKey(tenantId, route), {
      mean: snapshot.mean,
      m2: snapshot.m2,
      count: snapshot.count,
      window: snapshot.window.map((v) => v.slice()),
      lastSampleDistance: snapshot.lastSampleDistance,
    });
  }

  /**
   * Test-only helper — purge a single bucket. Not exported via the
   * barrel; tests reach for it via `DriftDetector.reset(...)`.
   */
  reset(tenantId?: string, route?: string): void {
    if (tenantId === undefined || route === undefined) {
      this.buckets.clear();
      return;
    }
    this.buckets.delete(bucketKey(tenantId, route));
  }
}

// ─────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────

function bucketKey(tenantId: string, route: string): string {
  // ':' is not legal in tenant ids / route names → safe separator.
  return `${tenantId}::${route}`;
}

function createBucket(): BucketState {
  return {
    mean: 0,
    m2: 0,
    count: 0,
    window: [],
    lastSampleDistance: 0,
  };
}

function computeCentroid(
  window: ReadonlyArray<ReadonlyArray<number>>,
): number[] | null {
  if (window.length === 0) return null;
  const first = window[0] as ReadonlyArray<number>;
  const dim = first.length;
  if (dim === 0) return null;
  const sum: number[] = new Array<number>(dim).fill(0);
  let kept = 0;
  for (const vec of window) {
    if (!vec || vec.length !== dim) continue;
    for (let i = 0; i < dim; i += 1) {
      sum[i] = (sum[i] ?? 0) + (vec[i] ?? 0);
    }
    kept += 1;
  }
  if (kept === 0) return null;
  for (let i = 0; i < dim; i += 1) {
    sum[i] = (sum[i] ?? 0) / kept;
  }
  return sum;
}

function cosine(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
