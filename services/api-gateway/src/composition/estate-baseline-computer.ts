/**
 * Estate-baseline computer — the episodic→semantic "sleep" transition for
 * ESTATE OBSERVABLES (Memory Consolidation & Schema Formation, write side).
 *
 * THE LOOP THIS CLOSES
 * ────────────────────
 * `resolveDriveThresholdsFromBaselines` (estate-mind-perception.ts) READS
 * `baseline:<scope>:<metric>` semantic facts (`{ mean, sd }`) to re-tune each
 * standing drive's threshold to `mean ± k·sd` for THIS estate — so a nudge
 * fires on what is anomalous for this estate, not a global static floor. But
 * until something WRITES those facts the resolver returns `{}` and every drive
 * runs on its built-in `DEFAULT_DRIVE_THRESHOLDS`. THIS module is the writer:
 * the nightly consolidation pass calls `computeEstateBaselines(db, tenantId)`
 * and UPSERTs each returned baseline as the very fact the resolver reads.
 *
 * WHAT "BASELINE" MEANS HERE
 * ──────────────────────────
 * A baseline is the per-`(scope, metric)` shape of an estate observable over a
 * trailing window — its `mean`, sample standard deviation `sd`, and sample
 * count `n`. It is computed from a genuine windowed SAMPLE (a series of
 * point-in-time observations), never from a single current reading. A metric
 * with fewer than `MIN_SAMPLES` observations in the window emits NO baseline —
 * we never fabricate a "normal" from too-little history (honest-degrade). That
 * tenant simply keeps its static thresholds for that metric.
 *
 * METRICS (each → the resolver token it tunes)
 * ────────────────────────────────────────────
 *   cash_runway_d   floor   ← `forecasts.mid` series (metric='cash_runway_d')
 *   licence_renewal floor   ← `licences` term length (expiry_date − grant_date)
 *   open_incidents  ceiling ← `incidents` daily open-count series
 *   production_t    (fwd)   ← `production_tonnage_events` daily ore-tonnes series
 *
 * The first three bind directly onto `cashRunwayDaysFloor`,
 * `licenceRenewalDaysFloor`, and `safetyOpenIncidentsCeiling` via the
 * resolver's `BASELINE_BINDINGS`. `production_t` is a real estate observable the
 * resolver does not yet bind to a drive — writing it is harmless (unbound keys
 * are ignored on read) and forward-compatible: the moment a production drive is
 * added, its threshold is already schema-conditioned.
 *
 * The offtake-coverage, royalty-arrears, and equipment-health drives read
 * CURRENT estate state with no single-table historical series to window over,
 * so this pass deliberately emits NO baseline for them — they keep their static
 * thresholds until a real series exists. Skipping is the honest choice; a
 * fabricated baseline would mistune a live drive.
 *
 * HARD RAILS
 * ──────────
 *   - TENANT-SCOPED. Every read carries an explicit `tenant_id = ${tenantId}`
 *     predicate. The caller runs this inside a service-role context (the
 *     out-of-band sleep job has no request middleware to bind the GUC); RLS
 *     FORCE still isolates every other caller.
 *   - PURE-ish + READ-ONLY. This module only READS and returns plain data. It
 *     never writes (the runner owns the upsert), never actuates, never reaches a
 *     client.
 *   - DEGRADE GRACEFULLY. A missing table / column / empty window yields no
 *     baseline for that metric and NEVER throws to the caller. A whole-tenant
 *     read fault returns `[]` (no baselines → static thresholds), not an error.
 *   - No `console.*` (the runner owns the Pino logging of the per-tenant count).
 *   - Immutable (frozen results).
 */

import { sql } from 'drizzle-orm';

/** Narrow structural db seam — only `execute(sql)` is needed (test-double-able). */
export interface BaselineDbExecLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Minimum windowed observations required before a metric earns a baseline.
 * Below this the sample is too small to estimate a meaningful mean/sd, so the
 * metric is skipped (honest-degrade) and the drive keeps its static threshold.
 * Five is a deliberately conservative floor — enough for a non-degenerate sd,
 * small enough that an estate with a few weeks of history starts benefiting.
 */
export const MIN_BASELINE_SAMPLES = 5;

/** Default trailing window the computer samples over. 90 days ≈ one quarter. */
export const DEFAULT_BASELINE_WINDOW_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** One computed baseline for a `(scope, metric)` estate observable. */
export interface EstateBaseline {
  /** Situational scope the baseline is for. Estate-wide today. */
  readonly scope: string;
  /** Metric token the resolver matches against (e.g. `cash_runway_d`). */
  readonly metric: string;
  /** Sample mean over the window. */
  readonly mean: number;
  /** Sample standard deviation (Bessel-corrected, n−1). `0` when n is 1. */
  readonly sd: number;
  /** Number of observations the mean/sd were computed from (≥ MIN_SAMPLES). */
  readonly n: number;
}

export interface ComputeEstateBaselinesOptions {
  /** Trailing window to sample over, in days. Default 90. */
  readonly windowDays?: number;
  /** Minimum sample size before a metric earns a baseline. Default 5. */
  readonly minSamples?: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

// ---------------------------------------------------------------------------
// Pure statistics
// ---------------------------------------------------------------------------

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(rows) ? rows : [];
}

/** Coerce a pg numeric/text/number cell to a finite JS number, or null. */
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

/**
 * Mean + Bessel-corrected (n−1) sample standard deviation of a numeric sample.
 * Returns `null` when the sample is shorter than `minSamples` — the caller then
 * omits the metric (honest-degrade). Non-finite entries are dropped before the
 * count check, so a sample padded with nulls cannot sneak past the guard.
 */
export function meanSdN(
  sample: ReadonlyArray<number>,
  minSamples: number,
): { mean: number; sd: number; n: number } | null {
  const clean = sample.filter((x) => Number.isFinite(x));
  const n = clean.length;
  if (n < Math.max(1, minSamples)) return null;
  const mean = clean.reduce((a, b) => a + b, 0) / n;
  // n−1 denominator; for n=1 (only reachable if minSamples were 1) sd is 0.
  const variance =
    n > 1 ? clean.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1) : 0;
  const sd = Math.sqrt(Math.max(0, variance));
  return { mean, sd, n };
}

// ---------------------------------------------------------------------------
// Per-metric windowed sample readers — each returns a numeric SAMPLE array.
// Every reader is independently fault-isolated by the caller: a missing table
// or empty window degrades to [] (no baseline), never throws.
// ---------------------------------------------------------------------------

/**
 * cash_runway_d (floor) — the `mid` estimate of each `cash_runway_d` forecast
 * computed within the window. The `forecasts` table is already a time-series of
 * model outputs, so each `computed_at` row is one observation of the estate's
 * runway-days normal.
 */
async function sampleCashRunway(
  db: BaselineDbExecLike,
  tenantId: string,
  cutoff: Date,
): Promise<ReadonlyArray<number>> {
  const res = await db.execute(sql`
    SELECT mid, low
      FROM forecasts
     WHERE tenant_id = ${tenantId}
       AND metric = 'cash_runway_d'
       AND computed_at >= ${cutoff}
     ORDER BY computed_at ASC
  `);
  const out: number[] = [];
  for (const row of rowsOf(res)) {
    // Prefer the central estimate; fall back to the conservative low bound —
    // the same precedence the cash perceiver uses.
    const v = numOf(row.mid) ?? numOf(row.low);
    if (v !== null) out.push(v);
  }
  return out;
}

/**
 * licence_renewal (floor) — the term length `(expiry_date − grant_date)` in
 * whole days for every licence with both dates. This is the renewal lead-time
 * the estate historically operates on: a per-licence sample of "how long a
 * licence runs before it must be renewed." Non-positive / malformed spans are
 * dropped. Window-independent (a licence's term is a structural fact, not a
 * dated event) so we sample the whole book.
 */
async function sampleLicenceRenewal(
  db: BaselineDbExecLike,
  tenantId: string,
): Promise<ReadonlyArray<number>> {
  const res = await db.execute(sql`
    SELECT grant_date, expiry_date
      FROM licences
     WHERE tenant_id = ${tenantId}
       AND grant_date IS NOT NULL
       AND expiry_date IS NOT NULL
  `);
  const out: number[] = [];
  for (const row of rowsOf(res)) {
    const grant = Date.parse(String(row.grant_date));
    const expiry = Date.parse(String(row.expiry_date));
    if (!Number.isFinite(grant) || !Number.isFinite(expiry)) continue;
    const days = Math.round((expiry - grant) / MS_PER_DAY);
    if (days > 0) out.push(days);
  }
  return out;
}

// SAFETY DELIBERATELY NOT BASELINED — a daily ESTATE-WIDE incident-OCCURRENCE
// count (occurred_at, any status) is a different population + unit from the live
// safety signal it would gate (perceiveSafety counts CURRENTLY-OPEN incidents
// PER-SITE). Tuning the safety ceiling off that mismatched series would
// DESENSITISE the safety drive. Safety keeps its static, conservative ceiling
// (honest-degrade) — the same choice made for offtake/arrears/equipment, whose
// current-state signals have no comparable windowed series. A future
// per-site-open time-series could baseline this correctly.

/**
 * production_t (forward, unbound) — daily total ore tonnage from
 * `production_tonnage_events` over the window. One observation per active
 * production day: the estate's daily-tonnage normal. The resolver does not yet
 * bind this to a drive, so writing it tunes nothing today — but it is a real
 * estate observable and forward-compatible (an added production drive inherits
 * a schema-conditioned threshold immediately).
 */
async function sampleProductionTonnage(
  db: BaselineDbExecLike,
  tenantId: string,
  cutoff: Date,
): Promise<ReadonlyArray<number>> {
  // `production_tonnage_events.tenant_id` is a `uuid` column (unlike the
  // `text` tenant_id on forecasts/licences/incidents), so the bound param is
  // cast to uuid to match — the idiom every tonnage query in the repo uses.
  const res = await db.execute(sql`
    SELECT SUM(ore_tonnes) AS day_tonnes
      FROM production_tonnage_events
     WHERE tenant_id = ${tenantId}::uuid
       AND captured_at >= ${cutoff}
       AND qa_status = 'passed'
     GROUP BY date_trunc('day', captured_at)
  `);
  const out: number[] = [];
  for (const row of rowsOf(res)) {
    const v = numOf(row.day_tonnes);
    if (v !== null && v > 0) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metric registry — one entry per estate observable we baseline.
// ---------------------------------------------------------------------------

interface BaselineMetricSpec {
  readonly metric: string;
  readonly read: (
    db: BaselineDbExecLike,
    tenantId: string,
    cutoff: Date,
  ) => Promise<ReadonlyArray<number>>;
}

const BASELINE_METRICS: ReadonlyArray<BaselineMetricSpec> = Object.freeze([
  { metric: 'cash_runway_d', read: (db, t, c) => sampleCashRunway(db, t, c) },
  { metric: 'licence_renewal', read: (db, t) => sampleLicenceRenewal(db, t) },
  // open_incidents intentionally absent — see the SAFETY note above (population/
  // unit mismatch would desensitise the safety drive). Static ceiling retained.
  { metric: 'production_t', read: (db, t, c) => sampleProductionTonnage(db, t, c) },
]);

/** Single situational scope today — estate-wide. Keyed `baseline:estate:<metric>`. */
const ESTATE_SCOPE = 'estate';

// ---------------------------------------------------------------------------
// Public API — compute the per-(scope, metric) baselines for one tenant.
// ---------------------------------------------------------------------------

/**
 * Compute every available estate baseline for ONE tenant over the trailing
 * window. Each metric is read independently and fault-isolated: a missing table
 * or read fault degrades to no baseline for that metric (never aborts the
 * others, never throws to the caller). A metric whose windowed sample has fewer
 * than `minSamples` observations is OMITTED — honest-degrade, never a baseline
 * fabricated from too-little data.
 *
 * Returns a frozen array of `EstateBaseline` (possibly empty). The caller
 * (consolidation-runner) UPSERTs each as a `baseline:<scope>:<metric>` semantic
 * fact the drive-threshold resolver reads.
 */
export async function computeEstateBaselines(
  db: BaselineDbExecLike | null | undefined,
  tenantId: string,
  options: ComputeEstateBaselinesOptions = {},
): Promise<ReadonlyArray<EstateBaseline>> {
  if (!db || !tenantId) return Object.freeze([]);
  const windowDays =
    Number.isFinite(options.windowDays) && (options.windowDays as number) > 0
      ? Math.floor(options.windowDays as number)
      : DEFAULT_BASELINE_WINDOW_DAYS;
  const minSamples =
    Number.isFinite(options.minSamples) && (options.minSamples as number) >= 1
      ? Math.floor(options.minSamples as number)
      : MIN_BASELINE_SAMPLES;
  const nowMs = options.now?.() ?? Date.now();
  const cutoff = new Date(nowMs - windowDays * MS_PER_DAY);

  const computed = await Promise.all(
    BASELINE_METRICS.map(async (spec): Promise<EstateBaseline | null> => {
      let sample: ReadonlyArray<number> = [];
      try {
        sample = await spec.read(db, tenantId, cutoff);
      } catch {
        // Missing table / column / read fault → no observation for this metric.
        // The whole-tenant fault path is handled by the caller's try/catch; a
        // single metric failing must not abort the others, so swallow here and
        // treat as an empty sample (no baseline emitted).
        return null;
      }
      const stats = meanSdN(sample, minSamples);
      if (!stats) return null;
      return Object.freeze({
        scope: ESTATE_SCOPE,
        metric: spec.metric,
        mean: stats.mean,
        sd: stats.sd,
        n: stats.n,
      }) satisfies EstateBaseline;
    }),
  );

  return Object.freeze(
    computed.filter((b): b is EstateBaseline => b !== null),
  );
}

/**
 * The semantic-fact key the {@link computeEstateBaselines} writer + the
 * drive-threshold resolver agree on: `baseline:<scope>:<metric>`. Exposed so
 * the runner (and tests) build the exact key the resolver's
 * `key LIKE 'baseline:%'` read matches — no string drift between writer and
 * reader.
 */
export function baselineFactKey(baseline: EstateBaseline): string {
  return `baseline:${baseline.scope}:${baseline.metric}`;
}
