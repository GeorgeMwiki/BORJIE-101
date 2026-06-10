/**
 * Causal DAG + do-calculus-lite ROOT-CAUSE engine (Wave D — causal reasoning).
 *
 * THE GAP THIS CLOSES
 * ───────────────────
 * Today Mr. Mwikila can SHOW that cash dipped and that, in the same window,
 * the royalty filing was late AND production softened — but it gestures at
 * CORRELATION and lets the owner guess which one is the REASON. This module
 * lets the brain say, with evidence: "the REASON cash dipped was the late
 * royalty filing — production is a red herring; it moved too, but it moves
 * cash with a lag that doesn't line up, and its own move was small." A wrong
 * root cause is worse than none, so when nothing clears the confidence floor
 * the engine returns an explicit { established: false, reason } — never a
 * fabricated causal claim.
 *
 * HOW IT WORKS (two stages)
 * ─────────────────────────
 * 1. buildCausalDag(db, tenantId) — the estate's observable METRICS (cash
 *    runway, sales receipts, production tonnage, royalty-filing timeliness) are
 *    the causal nodes; a small DOMAIN-PRIOR set of candidate directed edges is
 *    the hypothesis space. Each candidate is PROMOTED to a causal edge only if
 *    it validates against this tenant's history: (a) TEMPORAL PRECEDENCE — the
 *    cause leads the effect by a non-negative lag — and (b) lagged CORRELATION
 *    above a strength floor over enough paired observations. Failing candidates
 *    are DROPPED (honest-degrade — never an unvalidated cause). ACYCLIC by
 *    construction: a cycle-break keeps the strongest temporally-valid edge.
 *
 * 2. explainRootCause(dag, { metric, observedDeltaPct, asOf }) — walks UPSTREAM
 *    from the moved KPI and scores each ancestor by (path edge strength × that
 *    ancestor's OWN realized move). A node earns leverage only if it ITSELF
 *    moved AND has a validated route to the KPI. Returns the top cause, the
 *    ranked list, the "ruled out" red herrings, a confidence + evidence rows —
 *    or { established: false, reason } when nothing clears the floor.
 *
 * HARD RAILS (BORJIE invariants)
 * ──────────────────────────────
 *   - TENANT-SCOPED. Every read carries an explicit `tenant_id = ${tenantId}`
 *     predicate. The caller runs inside a pinned/`withTenantContext` handle so
 *     RLS FORCE also filters server-side. This module only READS the
 *     ledger/production/royalty series for ANALYSIS — it never writes
 *     accounting truth (money path stays LedgerService-only) and never
 *     actuates. A "commit as plan" action, if a consumer offers one, must route
 *     through the existing governed action membrane — this engine only explains.
 *   - HONEST-DEGRADE. A missing table / thin window / sub-floor support yields
 *     a dropped edge or an { established: false } result, NEVER a guessed cause.
 *   - IMMUTABLE. All returned structures are frozen; no input is mutated.
 *   - PINO ONLY. No `console.*` — the shared logger handles redaction.
 *
 * Companion to:
 *   - services/api-gateway/src/composition/knowledge-graph/postgres-kg-store.ts
 *   - services/api-gateway/src/composition/estate-baseline-computer.ts
 *     (same windowed-series reader idiom: forecasts / production_tonnage_events
 *      / sales / royalty_return_drafts, fault-isolated per metric).
 */

import { sql } from 'drizzle-orm';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('causal-dag');

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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default trailing window the engine samples its series over. */
export const DEFAULT_CAUSAL_WINDOW_DAYS = 120;

/**
 * Minimum number of PAIRED (lag-aligned) observations before a candidate edge
 * may be validated. Below this the correlation estimate is too unstable to
 * trust — the edge is dropped (honest-degrade), never asserted.
 */
export const MIN_PAIRED_OBSERVATIONS = 4;

/**
 * Minimum |correlation| a lag-aligned candidate must reach to be promoted to a
 * validated causal edge. Deliberately conservative — a weak co-move is not a
 * cause.
 */
export const MIN_EDGE_STRENGTH = 0.35;

/**
 * The candidate lags (in days) the validator scans. A cause that leads its
 * effect by one of these lags satisfies temporal precedence; lag 0 is a
 * same-bucket contemporaneous move (still "cause not after effect"). Negative
 * lags are NEVER scanned — that would let an effect "precede" its cause.
 */
const CANDIDATE_LAG_DAYS: ReadonlyArray<number> = Object.freeze([0, 7, 14, 30]);

/**
 * Confidence floor a root-cause explanation must clear to be `established`.
 * Below this we return { established: false } rather than name a weak cause.
 */
export const ROOT_CAUSE_CONFIDENCE_FLOOR = 0.3;

/**
 * A node is treated as having "actually moved" in the window only if its
 * realized fractional move exceeds this. Smaller wiggles are noise and must not
 * be promoted into a cause.
 */
const MIN_REALIZED_MOVE = 0.02;

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

const ALL_METRICS: ReadonlyArray<CausalMetric> = Object.freeze([
  'cash_runway',
  'sales_receipts',
  'production_tonnage',
  'royalty_filing_lateness',
]);

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
// Causal DAG types
// ───────────────────────────────────────────────────────────────────────────

/** A validated causal edge `from → to` with strength / confidence / lag. */
export interface CausalEdge {
  readonly from: CausalMetric;
  readonly to: CausalMetric;
  /** |lagged correlation| in [0,1]; the do-calculus-lite "strength". */
  readonly strength: number;
  /** Validation confidence in [0,1] — strength tempered by sample support. */
  readonly confidence: number;
  /** Best-fit lag (days) by which the cause leads the effect (≥ 0). */
  readonly lagDays: number;
  /** Sign of the relationship (+1 same-direction, −1 inverse). */
  readonly sign: 1 | -1;
  /** Number of paired observations the validation rested on. */
  readonly support: number;
}

/** A node in the causal DAG — one estate metric. */
export interface CausalNode {
  readonly metric: CausalMetric;
  /** Whether this tenant had any series data for the metric. */
  readonly hasData: boolean;
  readonly points: number;
}

/** The tenant's validated causal DAG. Acyclic by construction. */
export interface CausalDag {
  readonly tenantId: string;
  readonly nodes: ReadonlyArray<CausalNode>;
  readonly edges: ReadonlyArray<CausalEdge>;
  /** Candidate edges that were DROPPED, with the reason — auditable honesty. */
  readonly dropped: ReadonlyArray<DroppedCandidate>;
  /** The window the series were sampled over. */
  readonly windowDays: number;
  readonly asOf: number;
}

export interface DroppedCandidate {
  readonly from: CausalMetric;
  readonly to: CausalMetric;
  readonly reason:
    | 'no_temporal_precedence'
    | 'below_strength_floor'
    | 'insufficient_paired_data'
    | 'cycle_break_weaker_edge'
    | 'no_series';
}

// ───────────────────────────────────────────────────────────────────────────
// Domain-prior candidate edges — the estate's causal STRUCTURE (what *could*
// cause what) and the ONLY hypotheses the validator may promote. Each asserts a
// mechanism the data must then confirm with precedence + lagged correlation;
// the set is acyclic by design.
//   production → sales       more ore mined feeds more saleable inventory
//   sales      → cash        sale receipts replenish runway
//   production → cash        direct (sold-at-pit / advances) shortcut path
//   royalty_late → cash      late filing → penalty / blocked disbursement
//   production → royalty_late larger return → more likely to slip its window
// ───────────────────────────────────────────────────────────────────────────

interface CandidateEdge {
  readonly from: CausalMetric;
  readonly to: CausalMetric;
}

const CANDIDATE_EDGES: ReadonlyArray<CandidateEdge> = Object.freeze([
  { from: 'production_tonnage', to: 'sales_receipts' },
  { from: 'sales_receipts', to: 'cash_runway' },
  { from: 'production_tonnage', to: 'cash_runway' },
  { from: 'royalty_filing_lateness', to: 'cash_runway' },
  { from: 'production_tonnage', to: 'royalty_filing_lateness' },
]);

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
function dayBucket(t: number): number {
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
function bucketize(points: ReadonlyArray<MetricPoint>): Map<number, number> {
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
 * royalty_filing_lateness — per royalty return draft, the days between its
 * statutory due date and when it was actually filed (late = positive; on-time /
 * early clamp to 0). Keyed on the due date so it aligns temporally with the
 * obligation. Unfiled-but-past-due rows are skipped: we measure REALIZED
 * lateness, not projected (no server-side "now" here — honest).
 */
async function readRoyaltyFilingLateness(
  db: CausalDbExecLike,
  tenantId: string,
  cutoff: Date,
): Promise<ReadonlyArray<MetricPoint>> {
  const res = await db.execute(sql`
    SELECT id, due_at, submitted_at, period_start
      FROM royalty_return_drafts
     WHERE tenant_id = ${tenantId}
       AND due_at IS NOT NULL
       AND due_at >= ${cutoff}
     ORDER BY due_at ASC
  `);
  const out: MetricPoint[] = [];
  for (const row of rowsOf(res)) {
    const due = tsOf(row.due_at);
    if (due === null) continue;
    const submitted = tsOf(row.submitted_at);
    if (submitted === null) continue; // unfiled → no realized lateness yet
    const lateDays = Math.max(0, Math.round((submitted - due) / MS_PER_DAY));
    out.push({
      t: due,
      value: lateDays,
      evidenceId: `royalty_return:${String(row.id ?? '')}`,
    });
  }
  return out;
}

interface MetricReaderSpec {
  readonly metric: CausalMetric;
  readonly read: (
    db: CausalDbExecLike,
    tenantId: string,
    cutoff: Date,
  ) => Promise<ReadonlyArray<MetricPoint>>;
}

const METRIC_READERS: ReadonlyArray<MetricReaderSpec> = Object.freeze([
  { metric: 'cash_runway', read: readCashRunway },
  { metric: 'sales_receipts', read: readSalesReceipts },
  { metric: 'production_tonnage', read: readProductionTonnage },
  { metric: 'royalty_filing_lateness', read: readRoyaltyFilingLateness },
]);

// ───────────────────────────────────────────────────────────────────────────
// Edge validation — lagged correlation + temporal precedence.
// ───────────────────────────────────────────────────────────────────────────

interface LagFit {
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
function bestLaggedFit(
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

/**
 * Confidence = |r| tempered by sample support, so a strong correlation on few
 * pairs is discounted relative to the same strength on many pairs. Saturates
 * toward |r| as support grows. Bounded [0,1].
 */
function edgeConfidence(absR: number, support: number): number {
  const supportFactor = support / (support + MIN_PAIRED_OBSERVATIONS);
  return Math.max(0, Math.min(1, absR * supportFactor));
}

// ───────────────────────────────────────────────────────────────────────────
// Acyclicity guard — keep the strongest temporally-valid edge on any cycle.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Greedily admit validated edges strongest-first, skipping any edge that would
 * introduce a cycle into the accepted set. Because we admit the strongest edge
 * first, a residual cycle is always broken by dropping the WEAKER back-edge —
 * exactly the mandated tie-break. Returns the acyclic accepted set + the edges
 * dropped for cycle-breaking.
 */
function enforceAcyclic(
  edges: ReadonlyArray<CausalEdge>,
): { kept: ReadonlyArray<CausalEdge>; dropped: ReadonlyArray<DroppedCandidate> } {
  const ordered = [...edges].sort((a, b) => b.strength - a.strength);
  const adjacency = new Map<CausalMetric, Set<CausalMetric>>();
  const kept: CausalEdge[] = [];
  const dropped: DroppedCandidate[] = [];

  const reaches = (start: CausalMetric, target: CausalMetric): boolean => {
    // DFS over current accepted adjacency: does `start` already reach `target`?
    const stack: CausalMetric[] = [start];
    const seen = new Set<CausalMetric>();
    while (stack.length > 0) {
      const cur = stack.pop() as CausalMetric;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nxt of adjacency.get(cur) ?? []) stack.push(nxt);
    }
    return false;
  };

  for (const e of ordered) {
    // Adding from→to creates a cycle iff `to` already reaches `from`.
    if (reaches(e.to, e.from)) {
      dropped.push({ from: e.from, to: e.to, reason: 'cycle_break_weaker_edge' });
      continue;
    }
    kept.push(e);
    const set = adjacency.get(e.from) ?? new Set<CausalMetric>();
    set.add(e.to);
    adjacency.set(e.from, set);
  }
  return { kept, dropped };
}

// ───────────────────────────────────────────────────────────────────────────
// Public: buildCausalDag
// ───────────────────────────────────────────────────────────────────────────

export interface BuildCausalDagOptions {
  readonly windowDays?: number;
  readonly minStrength?: number;
  readonly minPairedObservations?: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
  /**
   * Pre-read series (test seam). When provided, the DB readers are bypassed and
   * these series are validated directly — lets unit tests feed a synthetic DAG
   * without a DB. Production callers omit this.
   */
  readonly seriesOverride?: ReadonlyArray<MetricSeries>;
}

/**
 * Build the tenant's validated causal DAG. Reads each metric's windowed series
 * (fault-isolated), promotes each domain-prior candidate edge that clears
 * temporal precedence + the strength floor + minimum paired support, then
 * enforces acyclicity. Returns a frozen DAG; a tenant with no series yields a
 * DAG of data-less nodes and zero edges (honest-degrade) — never a guess.
 */
export async function buildCausalDag(
  db: CausalDbExecLike | null | undefined,
  tenantId: string,
  options: BuildCausalDagOptions = {},
): Promise<CausalDag> {
  const windowDays =
    Number.isFinite(options.windowDays) && (options.windowDays as number) > 0
      ? Math.floor(options.windowDays as number)
      : DEFAULT_CAUSAL_WINDOW_DAYS;
  const minStrength =
    Number.isFinite(options.minStrength) && (options.minStrength as number) >= 0
      ? (options.minStrength as number)
      : MIN_EDGE_STRENGTH;
  const minPairs =
    Number.isFinite(options.minPairedObservations) &&
    (options.minPairedObservations as number) >= 2
      ? Math.floor(options.minPairedObservations as number)
      : MIN_PAIRED_OBSERVATIONS;
  const nowMs = options.now?.() ?? Date.now();
  const cutoff = new Date(nowMs - windowDays * MS_PER_DAY);

  // 1. Gather each metric's series (override seam OR fault-isolated DB reads).
  const seriesByMetric = new Map<CausalMetric, ReadonlyArray<MetricPoint>>();
  if (options.seriesOverride) {
    for (const s of options.seriesOverride) {
      seriesByMetric.set(s.metric, s.points);
    }
  } else if (db && tenantId) {
    const read = await Promise.all(
      METRIC_READERS.map(async (spec): Promise<[CausalMetric, ReadonlyArray<MetricPoint>]> => {
        try {
          const pts = await spec.read(db, tenantId, cutoff);
          return [spec.metric, pts];
        } catch {
          // Missing table / column / read fault → no series for this metric.
          // A single metric failing must not abort the others (honest-degrade).
          return [spec.metric, []];
        }
      }),
    );
    for (const [metric, pts] of read) seriesByMetric.set(metric, pts);
  }

  const nodes: ReadonlyArray<CausalNode> = ALL_METRICS.map((metric): CausalNode => {
    const pts = seriesByMetric.get(metric) ?? [];
    return Object.freeze({ metric, hasData: pts.length > 0, points: pts.length });
  });

  // 2. Validate each candidate edge against history.
  const validated: CausalEdge[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const cand of CANDIDATE_EDGES) {
    const cause = seriesByMetric.get(cand.from) ?? [];
    const effect = seriesByMetric.get(cand.to) ?? [];
    if (cause.length === 0 || effect.length === 0) {
      dropped.push({ from: cand.from, to: cand.to, reason: 'no_series' });
      continue;
    }
    const fit = bestLaggedFit(cause, effect, minPairs);
    if (fit === null) {
      dropped.push({ from: cand.from, to: cand.to, reason: 'insufficient_paired_data' });
      continue;
    }
    const strength = Math.abs(fit.r);
    if (strength < minStrength) {
      dropped.push({ from: cand.from, to: cand.to, reason: 'below_strength_floor' });
      continue;
    }
    // Temporal precedence: bestLaggedFit only scans lag ≥ 0, so any fit it
    // returns already has the cause leading (or contemporaneous with) the
    // effect. The explicit guard documents the invariant + future-proofs it.
    if (fit.lagDays < 0) {
      dropped.push({ from: cand.from, to: cand.to, reason: 'no_temporal_precedence' });
      continue;
    }
    const sign: 1 | -1 = fit.r >= 0 ? 1 : -1;
    validated.push(
      Object.freeze({
        from: cand.from,
        to: cand.to,
        strength,
        confidence: edgeConfidence(strength, fit.support),
        lagDays: fit.lagDays,
        sign,
        support: fit.support,
      }) satisfies CausalEdge,
    );
  }

  // 3. Enforce acyclicity (keep the strongest temporally-valid edge on a cycle).
  const { kept, dropped: cycleDropped } = enforceAcyclic(validated);

  logger.debug(
    {
      tenantId,
      nodes: nodes.length,
      validatedEdges: kept.length,
      droppedCandidates: dropped.length + cycleDropped.length,
      windowDays,
    },
    'built causal DAG',
  );

  return Object.freeze({
    tenantId,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(kept),
    dropped: Object.freeze([...dropped, ...cycleDropped]),
    windowDays,
    asOf: nowMs,
  }) satisfies CausalDag;
}

// ───────────────────────────────────────────────────────────────────────────
// Realized-move helper — how much did a metric ACTUALLY move in the window?
// ───────────────────────────────────────────────────────────────────────────

/**
 * Fractional realized move of a metric's series over its own window: the
 * signed change from the early-window mean to the late-window mean, normalised
 * by the early-window magnitude. Split at the series midpoint so each half has
 * support. Returns 0 when the series is too short or the baseline is ~0.
 */
function realizedMove(points: ReadonlyArray<MetricPoint>): number {
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

// ───────────────────────────────────────────────────────────────────────────
// Public: explainRootCause
// ───────────────────────────────────────────────────────────────────────────

export interface ExplainRootCauseInput {
  /** The KPI that was observed to move. */
  readonly metric: CausalMetric;
  /** The observed fractional move of the KPI (e.g. −0.18 for a −18% dip). */
  readonly observedDeltaPct: number;
  /** As-of epoch ms (informational; the DAG already fixed its window). */
  readonly asOf?: number;
  /**
   * The per-metric series the DAG was built from, so ancestors can be scored by
   * their OWN realized move. Production callers pass the same `seriesOverride`
   * they (or the builder) read; when omitted the builder must have been fed an
   * override and we fall back to edge strength alone (degraded scoring).
   */
  readonly series?: ReadonlyArray<MetricSeries>;
}

/** One scored upstream candidate cause. */
export interface RankedCause {
  readonly metric: CausalMetric;
  /** leverage = path strength × |ancestor realized move|. */
  readonly leverage: number;
  /** The validated edge strength on the best path to the KPI. */
  readonly pathStrength: number;
  /** The ancestor's own realized fractional move in the window. */
  readonly realizedMove: number;
  /** Total lag (days) along the best causal path to the KPI. */
  readonly lagDays: number;
  readonly confidence: number;
  readonly evidenceIds: ReadonlyArray<string>;
}

export type RootCauseResult =
  | {
      readonly established: true;
      /** The single highest-leverage upstream cause. */
      readonly rootCause: RankedCause;
      /** All scored upstream candidates, leverage-descending (incl. rootCause). */
      readonly ranked: ReadonlyArray<RankedCause>;
      /** Ancestors that moved but whose causal route was too weak — red herrings. */
      readonly ruledOut: ReadonlyArray<RankedCause>;
      readonly confidence: number;
      readonly metric: CausalMetric;
      readonly observedDeltaPct: number;
    }
  | {
      readonly established: false;
      readonly reason: string;
      readonly metric: CausalMetric;
      readonly observedDeltaPct: number;
      /** Whatever weak candidates existed, surfaced for transparency. */
      readonly ranked: ReadonlyArray<RankedCause>;
    };

/**
 * Walk UPSTREAM from the moved KPI and name its highest-leverage cause. For
 * each ancestor with a validated causal PATH we take the strongest-product path
 * and score it by `pathStrength × |ancestor realized move|`. An ancestor earns
 * leverage only if it ITSELF moved (> MIN_REALIZED_MOVE) AND has a validated
 * route — separating the real cause from a red herring that merely co-moved.
 * Returns the top cause + ranked list + ruled-out herrings + confidence +
 * evidence, or { established: false, reason } when no ancestor clears
 * ROOT_CAUSE_CONFIDENCE_FLOOR (or the KPI has no validated upstream at all).
 */
export function explainRootCause(
  dag: CausalDag,
  input: ExplainRootCauseInput,
): RootCauseResult {
  const { metric, observedDeltaPct } = input;

  // Index validated edges by their TARGET for upstream traversal.
  const incoming = new Map<CausalMetric, ReadonlyArray<CausalEdge>>();
  for (const e of dag.edges) {
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);
  }

  // Per-metric realized move + evidence, from the series the DAG was built on.
  const seriesByMetric = new Map<CausalMetric, ReadonlyArray<MetricPoint>>();
  for (const s of input.series ?? []) seriesByMetric.set(s.metric, s.points);
  const moveOf = (m: CausalMetric): number => {
    const pts = seriesByMetric.get(m);
    return pts ? realizedMove(pts) : 0;
  };
  const evidenceOf = (m: CausalMetric): ReadonlyArray<string> => {
    const pts = seriesByMetric.get(m) ?? [];
    // Dedupe + cap the evidence trail so the citation stays legible.
    return Object.freeze([...new Set(pts.map((p) => p.evidenceId))].slice(0, 12));
  };

  // Best causal PATH from each ancestor to the KPI: strongest product of edge
  // strengths (and accumulated lag), via a bounded BFS upstream from the KPI.
  interface PathInfo {
    readonly pathStrength: number;
    readonly lagDays: number;
    readonly confidence: number;
  }
  const best = new Map<CausalMetric, PathInfo>();
  // Seed: direct parents of the KPI.
  const queue: Array<{ node: CausalMetric; strength: number; lag: number; conf: number }> = [];
  for (const e of incoming.get(metric) ?? []) {
    queue.push({ node: e.from, strength: e.strength, lag: e.lagDays, conf: e.confidence });
  }
  // Bound traversal depth to the node count (DAG ⇒ no infinite walk; this is a
  // belt-and-braces cap).
  let guard = dag.nodes.length * dag.edges.length + dag.edges.length + 1;
  while (queue.length > 0 && guard-- > 0) {
    const cur = queue.shift() as {
      node: CausalMetric;
      strength: number;
      lag: number;
      conf: number;
    };
    const prior = best.get(cur.node);
    if (!prior || cur.strength > prior.pathStrength) {
      best.set(cur.node, {
        pathStrength: cur.strength,
        lagDays: cur.lag,
        confidence: cur.conf,
      });
      // Continue upstream through this ancestor's own parents (multiply
      // strengths along the path; accumulate lag; min the confidence).
      for (const e of incoming.get(cur.node) ?? []) {
        queue.push({
          node: e.from,
          strength: cur.strength * e.strength,
          lag: cur.lag + e.lagDays,
          conf: Math.min(cur.conf, e.confidence),
        });
      }
    }
  }

  // Score each reachable ancestor by leverage = pathStrength × |realized move|.
  const scored: RankedCause[] = [];
  for (const [m, info] of best) {
    const move = moveOf(m);
    const leverage = info.pathStrength * Math.abs(move);
    scored.push({
      metric: m,
      leverage,
      pathStrength: info.pathStrength,
      realizedMove: move,
      lagDays: info.lagDays,
      confidence: info.confidence,
      evidenceIds: evidenceOf(m),
    });
  }
  scored.sort((a, b) => b.leverage - a.leverage);

  if (scored.length === 0) {
    return Object.freeze({
      established: false as const,
      reason: `no validated causal ancestor for ${metric}; cannot establish a cause`,
      metric,
      observedDeltaPct,
      ranked: Object.freeze([]),
    });
  }

  // A node is a real candidate only if it ITSELF moved meaningfully. Ancestors
  // that did not move (or barely moved) are red herrings regardless of edge
  // strength — they cannot explain a KPI move they did not participate in.
  const movers = scored.filter((c) => Math.abs(c.realizedMove) >= MIN_REALIZED_MOVE);
  const nonMovers = scored.filter((c) => Math.abs(c.realizedMove) < MIN_REALIZED_MOVE);

  const top = movers[0];
  if (!top || top.confidence < ROOT_CAUSE_CONFIDENCE_FLOOR || top.leverage <= 0) {
    return Object.freeze({
      established: false as const,
      reason:
        top === undefined
          ? `no upstream metric moved enough to explain the ${metric} change; cannot establish a cause`
          : `best candidate '${top.metric}' confidence ${top.confidence.toFixed(2)} is below the ${ROOT_CAUSE_CONFIDENCE_FLOOR} floor; cannot establish a cause`,
      metric,
      observedDeltaPct,
      ranked: Object.freeze(scored),
    });
  }

  // Red herrings = scored ancestors that are NOT the top cause: either they
  // moved but lost on leverage, or they did not move at all.
  const ruledOut = Object.freeze([
    ...movers.slice(1),
    ...nonMovers,
  ]);

  logger.debug(
    {
      tenantId: dag.tenantId,
      metric,
      rootCause: top.metric,
      leverage: top.leverage,
      confidence: top.confidence,
      ruledOut: ruledOut.map((r) => r.metric),
    },
    'explained root cause',
  );

  return Object.freeze({
    established: true as const,
    rootCause: top,
    ranked: Object.freeze(scored),
    ruledOut,
    confidence: top.confidence,
    metric,
    observedDeltaPct,
  });
}
