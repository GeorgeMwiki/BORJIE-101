/**
 * Sleep Pass 4 — prune stale reflexions.
 *
 * Soft-deletes reflexions whose age has crossed the importance-adjusted
 * threshold. The base age cutoff is `MAX_AGE_DAYS` (default 30); the
 * importance multiplier extends the window for high-importance rows:
 *
 *   effective_max_age_days = MAX_AGE_DAYS * (1 + importance * 2)
 *
 * So importance=0   ⇒ 30 days, importance=0.5 ⇒ 60 days, importance=1 ⇒ 90 days.
 *
 * Rows that have been pruned already are skipped (idempotent).
 *
 * Pass 4 also tidies up dangling cluster_ids: if a row's cluster_id
 * points to a representative that's been pruned, the cluster_id is
 * cleared so the row becomes its own (potentially future) cluster.
 *
 * Soft-prune ONLY — the row stays in the table with `pruned_at` set.
 * Pass-4 deliberately does not hard-delete because:
 *   1. Audit / debugging needs the history.
 *   2. A later pass-1 might want to revive a row that turned out to be
 *      important after all (e.g. a single high-importance row from
 *      two months ago might still be the cluster representative).
 */

export interface PruneStalePort {
  loadCandidates(args: {
    readonly tenantId: string;
    readonly maxAgeDays: number;
    readonly limit: number;
  }): Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly importance: number;
      readonly recordedAt: string;
      readonly clusterId: string | null;
    }>
  >;
  markPruned(args: {
    readonly tenantId: string;
    readonly rowId: string;
    readonly prunedAtIso: string;
  }): Promise<void>;
  isRowPrunedOrMissing(args: {
    readonly tenantId: string;
    readonly rowId: string;
  }): Promise<boolean>;
  clearClusterId(args: {
    readonly tenantId: string;
    readonly rowId: string;
  }): Promise<void>;
}

export interface PruneStaleArgs {
  readonly tenantId: string;
  /** Base age cutoff. Default 30 days. */
  readonly baseMaxAgeDays?: number;
  /** Hard cap on rows examined per run. Default 5 000. */
  readonly limit?: number;
  /** Inject the clock for tests. */
  readonly nowMs?: number;
}

export interface PruneStaleReport {
  readonly tenantId: string;
  readonly examined: number;
  readonly pruned: number;
  readonly clusterIdsCleared: number;
  readonly notes: string;
}

const DEFAULT_BASE_MAX_AGE_DAYS = 30;
const DEFAULT_LIMIT = 5_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runPruneStalePass(
  port: PruneStalePort,
  args: PruneStaleArgs,
): Promise<PruneStaleReport> {
  const tenantId = args.tenantId;
  if (!tenantId) {
    return Object.freeze({
      tenantId,
      examined: 0,
      pruned: 0,
      clusterIdsCleared: 0,
      notes: 'skipped: invalid args',
    });
  }
  const baseMaxAgeDays = clampInt(
    args.baseMaxAgeDays ?? DEFAULT_BASE_MAX_AGE_DAYS,
    1,
    365,
  );
  const limit = clampInt(args.limit ?? DEFAULT_LIMIT, 10, 100_000);
  const nowMs = args.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // The widest possible cutoff (importance = 1 ⇒ 3× window) so the
  // candidate set includes any row that COULD be due for pruning.
  const widestMaxAgeDays = baseMaxAgeDays * 3;

  let rows: Awaited<ReturnType<PruneStalePort['loadCandidates']>>;
  try {
    rows = await port.loadCandidates({
      tenantId,
      maxAgeDays: widestMaxAgeDays,
      limit,
    });
  } catch {
    return Object.freeze({
      tenantId,
      examined: 0,
      pruned: 0,
      clusterIdsCleared: 0,
      notes: 'load failed',
    });
  }
  if (!rows || rows.length === 0) {
    return Object.freeze({
      tenantId,
      examined: 0,
      pruned: 0,
      clusterIdsCleared: 0,
      notes: 'no stale candidates',
    });
  }

  let pruned = 0;
  const prunedIds = new Set<string>();
  for (const row of rows) {
    if (!shouldPrune({ row, baseMaxAgeDays, nowMs })) continue;
    try {
      await port.markPruned({
        tenantId,
        rowId: row.id,
        prunedAtIso: nowIso,
      });
      pruned += 1;
      prunedIds.add(row.id);
    } catch {
      // Best-effort.
    }
  }

  // Tidy up dangling cluster_ids — rows whose representative got pruned
  // this run (or in some prior run) get their cluster_id cleared.
  let clusterIdsCleared = 0;
  for (const row of rows) {
    if (prunedIds.has(row.id)) continue; // already pruned itself
    if (!row.clusterId) continue;
    let representativeGone = prunedIds.has(row.clusterId);
    if (!representativeGone) {
      try {
        representativeGone = await port.isRowPrunedOrMissing({
          tenantId,
          rowId: row.clusterId,
        });
      } catch {
        representativeGone = false;
      }
    }
    if (representativeGone) {
      try {
        await port.clearClusterId({ tenantId, rowId: row.id });
        clusterIdsCleared += 1;
      } catch {
        // Best-effort.
      }
    }
  }

  return Object.freeze({
    tenantId,
    examined: rows.length,
    pruned,
    clusterIdsCleared,
    notes: `pruned ${pruned}/${rows.length}, cleared ${clusterIdsCleared} dangling cluster_ids`,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for tests).
// ─────────────────────────────────────────────────────────────────────

export function effectiveMaxAgeDays(
  importance: number,
  baseMaxAgeDays: number,
): number {
  const i = clamp01(importance);
  return baseMaxAgeDays * (1 + i * 2);
}

export function shouldPrune(args: {
  readonly row: {
    readonly importance: number;
    readonly recordedAt: string;
  };
  readonly baseMaxAgeDays: number;
  readonly nowMs: number;
}): boolean {
  const recordedMs = Date.parse(args.row.recordedAt);
  if (!Number.isFinite(recordedMs)) return false;
  const ageDays = (args.nowMs - recordedMs) / DAY_MS;
  if (ageDays <= 0) return false;
  const cutoff = effectiveMaxAgeDays(
    args.row.importance ?? 0,
    args.baseMaxAgeDays,
  );
  return ageDays >= cutoff;
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
