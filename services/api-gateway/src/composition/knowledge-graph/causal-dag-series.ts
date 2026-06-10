/**
 * Causal DAG — pure numeric primitives + tenant-scoped windowed SERIES readers.
 *
 * Extracted from causal-dag.ts (file-size cap) as a pure-move sibling: ZERO
 * behaviour change. This module owns the LEAF layer of the root-cause engine —
 * everything that has no dependency on the DAG types or the engine orchestration:
 *
 *   - The metric model (CausalMetric / MetricPoint / MetricSeries) + the narrow
 *     `CausalDbExecLike` db seam.
 *   - The tunables the validators read (window, paired-observation floor, edge
 *     strength floor, candidate lags, confidence floor, realized-move floor,
 *     royalty grace window).
 *   - Pure numeric helpers: pearson, day-bucketing (dayBucket / bucketize),
 *     edgeConfidence, bestLaggedFit, realizedMove + the pg cell coercions.
 *   - The four fault-isolated, tenant-scoped windowed series readers (cash
 *     runway, sales receipts, production tonnage, royalty-filing lateness) and
 *     the METRIC_READERS registry that drives buildCausalDag's gather phase.
 *
 * HARD RAILS (BORJIE) carry over unchanged. TENANT-SCOPED: every read carries
 * `tenant_id = ${tenantId}` and runs inside the caller's pinned/`withTenantContext`
 * handle so RLS FORCE also filters server-side. READ-ONLY: never writes accounting
 * truth (money path stays LedgerService-only), never actuates. HONEST-DEGRADE: a
 * missing table / thin window yields an empty series, never a guess. IMMUTABLE
 * (frozen tunables). PINO ONLY (no `console.*`).
 */

import { sql } from 'drizzle-orm';

// ───────────────────────────────────────────────────────────────────────────
// Narrow db seam — only `execute(sql)` is needed (test-double-able; the same
// seam every raw-SQL repository in this tree uses).
// ───────────────────────────────────────────────────────────────────────────

export interface CausalDbExecLike {
  execute(query: unknown): Promise<unknown>;
}

// ───────────────────────────────────────────────────────────────────────────
// Tunables
// ───────────────────────────────────────────────────────────────────────────

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default trailing window the engine samples its series over. */
export const DEFAULT_CAUSAL_WINDOW_DAYS = 120;

/** Min PAIRED (lag-aligned) observations before an edge may validate; below
 *  this the correlation is too unstable — the edge is dropped (honest-degrade). */
export const MIN_PAIRED_OBSERVATIONS = 4;

/** Min |correlation| a lag-aligned candidate must reach to be promoted to a
 *  validated causal edge. Conservative — a weak co-move is not a cause. */
export const MIN_EDGE_STRENGTH = 0.35;

/** Candidate lags (days) the validator scans. Lag 0 is contemporaneous; only
 *  non-negative lags are scanned, so an effect can never "precede" its cause. */
export const CANDIDATE_LAG_DAYS: ReadonlyArray<number> = Object.freeze([0, 7, 14, 30]);

/** Confidence floor a root-cause must clear to be `established`; below it we
 *  return { established: false } rather than name a weak cause. */
export const ROOT_CAUSE_CONFIDENCE_FLOOR = 0.3;

/** A node counts as having "actually moved" only if its realized fractional
 *  move exceeds this. Smaller wiggles are noise and cannot become a cause. */
export const MIN_REALIZED_MOVE = 0.02;

// ───────────────────────────────────────────────────────────────────────────
// Metric model — the causal nodes are the estate's observable metrics.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The canonical estate metrics the engine reasons over. Each maps to a
 * tenant-scoped windowed time-series reader below. `cash_runway` is the headline
 * solvency KPI; the rest are its candidate upstream drivers.
 */
export type CausalMetric =
  | 'cash_runway'
  | 'sales_receipts'
  | 'production_tonnage'
  | 'royalty_filing_lateness';

/** A single dated observation of one metric. */
export interface MetricPoint {
  /** Epoch ms for the bucket (day-truncated). */
  readonly t: number;
  /** Numeric value of the metric in that bucket. */
  readonly value: number;
  /** Source row id(s) backing this bucket — the evidence trail. */
  readonly evidenceId: string;
}

/** A dated, ordered series for one metric (ascending `t`). */
export interface MetricSeries {
  readonly metric: CausalMetric;
  readonly points: ReadonlyArray<MetricPoint>;
}

// ───────────────────────────────────────────────────────────────────────────
// Pure numeric helpers
// ───────────────────────────────────────────────────────────────────────────

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** Coerce a pg numeric/text/number/bigint cell to a finite JS number, or null. */
function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse a pg timestamp/date cell to epoch ms, or null. */
function tsOf(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** Day-bucket an epoch-ms timestamp to the UTC midnight that contains it. */
export function dayBucket(t: number): number {
  return Math.floor(t / MS_PER_DAY) * MS_PER_DAY;
}

/**
 * Pearson correlation of two equal-length numeric vectors. Returns 0 when a
 * vector is constant (zero variance) — a flat series cannot cause-correlate.
 */
export function pearson(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i] as number;
    sy += ys[i] as number;
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return 0;
  const r = cov / Math.sqrt(vx * vy);
  if (!Number.isFinite(r)) return 0;
  return Math.max(-1, Math.min(1, r));
}

/**
 * Build a per-day bucketed value map from raw observations, summing values that
 * fall in the same UTC day (so multiple events per day aggregate).
 */
export function bucketize(points: ReadonlyArray<MetricPoint>): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of points) {
    const b = dayBucket(p.t);
    m.set(b, (m.get(b) ?? 0) + p.value);
  }
  return m;
}

// ───────────────────────────────────────────────────────────────────────────
// Tenant-scoped windowed series readers (fault-isolated per metric).
// Each returns ascending-by-time MetricPoints, or [] on any read fault.
// Column/type idioms mirror estate-baseline-computer.ts + data-analysis-tools.
// ───────────────────────────────────────────────────────────────────────────

/** cash_runway — the `mid` of each `cash_runway_d` forecast in the window. */
async function readCashRunway(
  db: CausalDbExecLike,
  tenantId: string,
  cutoff: Date,
): Promise<ReadonlyArray<MetricPoint>> {
  const res = await db.execute(sql`
    SELECT id, mid, low, computed_at
      FROM forecasts
     WHERE tenant_id = ${tenantId}
       AND metric = 'cash_runway_d'
       AND computed_at >= ${cutoff}
     ORDER BY computed_at ASC
  `);
  const out: MetricPoint[] = [];
  for (const row of rowsOf(res)) {
    const t = tsOf(row.computed_at);
    const v = numOf(row.mid) ?? numOf(row.low);
    if (t === null || v === null) continue;
    out.push({ t, value: v, evidenceId: `forecast:${String(row.id ?? '')}` });
  }
  return out;
}

/** sales_receipts — `sales.net_tzs` keyed on the sale timestamp `ts`. */
async function readSalesReceipts(
  db: CausalDbExecLike,
  tenantId: string,
  cutoff: Date,
): Promise<ReadonlyArray<MetricPoint>> {
  const res = await db.execute(sql`
    SELECT id, net_tzs, ts
      FROM sales
     WHERE tenant_id = ${tenantId}
       AND ts >= ${cutoff}
     ORDER BY ts ASC
  `);
  const out: MetricPoint[] = [];
  for (const row of rowsOf(res)) {
    const t = tsOf(row.ts);
    const v = numOf(row.net_tzs);
    if (t === null || v === null) continue;
    out.push({ t, value: v, evidenceId: `sale:${String(row.id ?? '')}` });
  }
  return out;
}

/** production_tonnage — QA-passed `ore_tonnes` on the capture timestamp. */
async function readProductionTonnage(
  db: CausalDbExecLike,
  tenantId: string,
  cutoff: Date,
): Promise<ReadonlyArray<MetricPoint>> {
  // tenant_id is a uuid column on production_tonnage_events — cast to match the
  // idiom every tonnage query in the repo uses.
  const res = await db.execute(sql`
    SELECT id, ore_tonnes, captured_at
      FROM production_tonnage_events
     WHERE tenant_id = ${tenantId}::uuid
       AND captured_at >= ${cutoff}
       AND qa_status = 'passed'
     ORDER BY captured_at ASC
  `);
  const out: MetricPoint[] = [];
  for (const row of rowsOf(res)) {
    const t = tsOf(row.captured_at);
    const v = numOf(row.ore_tonnes);
    if (t === null || v === null || v <= 0) continue;
    out.push({ t, value: v, evidenceId: `tonnage_event:${String(row.id ?? '')}` });
  }
  return out;
}

/**
 * royalty_filing_lateness — per SUBMITTED royalty return, the days its filing ran
 * past the statutory due date (late = positive; on-time / early clamp to 0).
 *
 * royalty_return_drafts has NO explicit due_at / submitted_at column (real schema:
 * period_start, period_end, status, created_at, updated_at). So we derive both
 * from what exists, with the assumptions made EXPLICIT (honest proxy, not a
 * fabricated field): the statutory DUE date = period_end + the filing grace
 * window; the FILED time ≈ updated_at of a row that has reached status='submitted'
 * (the timestamp it became submitted). Keyed on the derived due date so it aligns
 * temporally with the obligation. Only realized (submitted) rows count — we never
 * project lateness for an unfiled return.
 */
// Statutory filing window after a royalty period closes. No explicit due column
// exists; this is a documented, tunable approximation (conservative).
const ROYALTY_DUE_GRACE_DAYS = 30;

async function readRoyaltyFilingLateness(
  db: CausalDbExecLike,
  tenantId: string,
  cutoff: Date,
): Promise<ReadonlyArray<MetricPoint>> {
  const res = await db.execute(sql`
    SELECT id, period_end, updated_at
      FROM royalty_return_drafts
     WHERE tenant_id = ${tenantId}
       AND status = 'submitted'
       AND period_end IS NOT NULL
       AND period_end >= ${cutoff}
     ORDER BY period_end ASC
  `);
  const out: MetricPoint[] = [];
  for (const row of rowsOf(res)) {
    const periodEnd = tsOf(row.period_end);
    if (periodEnd === null) continue;
    const filed = tsOf(row.updated_at);
    if (filed === null) continue; // unfiled → no realized lateness yet
    const due = periodEnd + ROYALTY_DUE_GRACE_DAYS * MS_PER_DAY;
    const lateDays = Math.max(0, Math.round((filed - due) / MS_PER_DAY));
    out.push({
      t: due,
      value: lateDays,
      evidenceId: `royalty_return:${String(row.id ?? '')}`,
    });
  }
  return out;
}

export interface MetricReaderSpec {
  readonly metric: CausalMetric;
  readonly read: (
    db: CausalDbExecLike,
    tenantId: string,
    cutoff: Date,
  ) => Promise<ReadonlyArray<MetricPoint>>;
}

export const METRIC_READERS: ReadonlyArray<MetricReaderSpec> = Object.freeze([
  { metric: 'cash_runway', read: readCashRunway },
  { metric: 'sales_receipts', read: readSalesReceipts },
  { metric: 'production_tonnage', read: readProductionTonnage },
  { metric: 'royalty_filing_lateness', read: readRoyaltyFilingLateness },
]);

// ───────────────────────────────────────────────────────────────────────────
// Edge validation — lagged correlation + temporal precedence.
// ───────────────────────────────────────────────────────────────────────────

export interface LagFit {
  readonly r: number;
  readonly lagDays: number;
  readonly support: number;
}

/**
 * Best non-negative lag at which `cause` leads `effect`. For each candidate lag
 * we pair cause@day with effect@(day+lag) and keep the lag whose |correlation|
 * is largest over enough paired observations. Non-negative lag enforces
 * temporal precedence (cause sampled before/at the effect, never after).
 * Returns null when no lag yields ≥ MIN_PAIRED_OBSERVATIONS pairs (the
 * candidate then cannot be validated).
 */
export function bestLaggedFit(
  cause: ReadonlyArray<MetricPoint>,
  effect: ReadonlyArray<MetricPoint>,
  minPairs: number,
): LagFit | null {
  if (cause.length === 0 || effect.length === 0) return null;
  const causeBuckets = bucketize(cause);
  const effectBuckets = bucketize(effect);
  let best: LagFit | null = null;
  for (const lagDays of CANDIDATE_LAG_DAYS) {
    const lagMs = lagDays * MS_PER_DAY;
    const xs: number[] = [];
    const ys: number[] = [];
    // Pair cause@day with effect@(day+lag): the cause precedes the effect.
    for (const [day, cv] of causeBuckets) {
      const ev = effectBuckets.get(day + lagMs);
      if (ev === undefined) continue;
      xs.push(cv);
      ys.push(ev);
    }
    const support = xs.length;
    if (support < minPairs) continue;
    const r = pearson(xs, ys);
    if (best === null || Math.abs(r) > Math.abs(best.r)) {
      best = { r, lagDays, support };
    }
  }
  return best;
}

/** Confidence = |r| tempered by sample support (a strong correlation on few
 *  pairs is discounted); saturates toward |r| as support grows. Bounded [0,1]. */
export function edgeConfidence(absR: number, support: number): number {
  const supportFactor = support / (support + MIN_PAIRED_OBSERVATIONS);
  return Math.max(0, Math.min(1, absR * supportFactor));
}

// ───────────────────────────────────────────────────────────────────────────
// Realized-move helper — how much did a metric ACTUALLY move in the window?
// ───────────────────────────────────────────────────────────────────────────

/** Fractional realized move of a series over its own window: signed change from
 *  the early-half mean to the late-half mean, normalised by the early magnitude
 *  (split at the midpoint). Returns 0 for a too-short series. */
export function realizedMove(points: ReadonlyArray<MetricPoint>): number {
  const byDay = bucketize(points);
  const days = [...byDay.keys()].sort((a, b) => a - b);
  if (days.length < 2) return 0;
  const mid = Math.floor(days.length / 2);
  const early = days.slice(0, mid);
  const late = days.slice(mid);
  if (early.length === 0 || late.length === 0) return 0;
  const mean = (ds: ReadonlyArray<number>): number =>
    ds.reduce((a, d) => a + (byDay.get(d) ?? 0), 0) / ds.length;
  const e = mean(early);
  const l = mean(late);
  const base = Math.abs(e);
  if (base < 1e-9) {
    // Baseline ~0 (e.g. lateness that was zero then spiked): express the move
    // as the absolute late magnitude over a unit floor so a 0→N spike still
    // registers as a real move rather than divide-by-zero noise.
    return l === 0 ? 0 : Math.sign(l - e) * Math.min(1, Math.abs(l - e));
  }
  return (l - e) / base;
}
