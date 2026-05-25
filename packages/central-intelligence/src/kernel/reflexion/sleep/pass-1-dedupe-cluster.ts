/**
 * Sleep Pass 1 — dedupe + cluster recent reflexions.
 *
 * Reflexions accumulate. After a week of agent activity the buffer
 * contains a long tail of near-duplicate self-critiques ("forgot to
 * confirm the unit number again", "should ask before assuming the
 * tenancy is monthly", ...). Naively prepending them all blows up the
 * prompt budget and dilutes salience.
 *
 * This pass:
 *   1. Reads the last `windowDays` of non-pruned reflexions for the
 *      tenant.
 *   2. Buckets them by a lightweight similarity signature (lower-cased
 *      bigram Jaccard) so near-duplicates land in the same cluster.
 *   3. Picks ONE representative per cluster — the most recent + highest
 *      importance row wins.
 *   4. Writes the representative's id into `cluster_id` on every
 *      duplicate. The loader uses cluster_id to collapse the bullet
 *      list to one entry per cluster.
 *
 * Idempotent across runs: rows that already have a cluster_id pointing
 * to a still-extant representative are left alone.
 *
 * Pure function except for the port. The port is the same as the loader
 * port plus an `updateClusterId` writer.
 */

import type { LoadedReflexion } from '../reflexion-loader.js';

export interface DedupeClusterPort {
  loadRecent(args: {
    readonly tenantId: string;
    readonly windowDays: number;
    readonly limit: number;
  }): Promise<ReadonlyArray<LoadedReflexion>>;
  updateClusterId(args: {
    readonly tenantId: string;
    readonly rowId: string;
    readonly clusterId: string | null;
  }): Promise<void>;
}

export interface DedupeClusterArgs {
  readonly tenantId: string;
  /** Default 7. */
  readonly windowDays?: number;
  /** Hard cap on rows pulled per run. Default 1000. */
  readonly limit?: number;
  /** 0..1 Jaccard threshold for cluster membership. Default 0.65. */
  readonly similarityThreshold?: number;
}

export interface DedupeClusterReport {
  readonly tenantId: string;
  readonly reflexionsScanned: number;
  readonly clusters: number;
  /** How many rows got a fresh cluster_id this run (excludes representatives). */
  readonly duplicatesLinked: number;
  readonly notes: string;
}

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_LIMIT = 1_000;
const DEFAULT_SIMILARITY_THRESHOLD = 0.65;

/**
 * Run pass 1. Returns a report. Never throws — port errors degrade to
 * an empty/zero report so the orchestrator can record the run as ok.
 */
export async function runDedupeClusterPass(
  port: DedupeClusterPort,
  args: DedupeClusterArgs,
): Promise<DedupeClusterReport> {
  const tenantId = args.tenantId;
  const empty: DedupeClusterReport = Object.freeze({
    tenantId,
    reflexionsScanned: 0,
    clusters: 0,
    duplicatesLinked: 0,
    notes: 'skipped: invalid args',
  });
  if (!tenantId) return empty;

  const windowDays = clampInt(args.windowDays ?? DEFAULT_WINDOW_DAYS, 1, 90);
  const limit = clampInt(args.limit ?? DEFAULT_LIMIT, 10, 10_000);
  const threshold = clamp01(
    args.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
  );

  let rows: ReadonlyArray<LoadedReflexion>;
  try {
    rows = (await port.loadRecent({ tenantId, windowDays, limit })) ?? [];
  } catch {
    return Object.freeze({ ...empty, notes: 'load failed' });
  }
  if (rows.length === 0) {
    return Object.freeze({
      tenantId,
      reflexionsScanned: 0,
      clusters: 0,
      duplicatesLinked: 0,
      notes: 'no reflexions in window',
    });
  }

  const clusters = clusterReflexions(rows, threshold);
  let duplicatesLinked = 0;

  for (const cluster of clusters) {
    const representative = pickRepresentative(cluster);
    if (!representative) continue;
    for (const row of cluster) {
      const desired = row.id === representative.id ? null : representative.id;
      if (row.clusterId === desired) continue;
      try {
        await port.updateClusterId({
          tenantId,
          rowId: row.id,
          clusterId: desired,
        });
        if (desired !== null) duplicatesLinked += 1;
      } catch {
        // Best-effort: one failed update doesn't poison the whole pass.
      }
    }
  }

  return Object.freeze({
    tenantId,
    reflexionsScanned: rows.length,
    clusters: clusters.length,
    duplicatesLinked,
    notes: `clustered ${rows.length} reflexion(s) into ${clusters.length} group(s)`,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Pure clustering helpers (small + exported for unit testing).
// ─────────────────────────────────────────────────────────────────────

/**
 * Greedy single-pass clusterer. For each reflexion, find the first
 * existing cluster whose representative crosses the Jaccard threshold;
 * otherwise start a new cluster. O(N²) worst case but N is bounded by
 * `limit` (default 1 000) — well under one second on modern hardware.
 */
export function clusterReflexions(
  rows: ReadonlyArray<LoadedReflexion>,
  threshold: number,
): ReadonlyArray<ReadonlyArray<LoadedReflexion>> {
  const clusters: LoadedReflexion[][] = [];
  const signatures: Set<string>[] = [];

  for (const row of rows) {
    const sig = bigramSet(row.reflection);
    let placed = false;
    for (let i = 0; i < clusters.length; i += 1) {
      const ref = signatures[i];
      if (!ref) continue;
      if (jaccard(sig, ref) >= threshold) {
        clusters[i]!.push(row);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([row]);
      signatures.push(sig);
    }
  }
  return clusters;
}

/**
 * Pick the cluster's representative — most recent first, then highest
 * importance, then lowest id (stable tiebreak).
 */
export function pickRepresentative(
  cluster: ReadonlyArray<LoadedReflexion>,
): LoadedReflexion | null {
  if (cluster.length === 0) return null;
  const sorted = [...cluster].sort((a, b) => {
    const at = a.recordedAt;
    const bt = b.recordedAt;
    if (at !== bt) return at < bt ? 1 : -1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0] ?? null;
}

export function bigramSet(s: string): Set<string> {
  const normalised = (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const out = new Set<string>();
  if (normalised.length < 2) {
    if (normalised.length === 1) out.add(normalised);
    return out;
  }
  for (let i = 0; i < normalised.length - 1; i += 1) {
    out.add(normalised.slice(i, i + 2));
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const k of a) if (b.has(k)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const v = Math.trunc(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
