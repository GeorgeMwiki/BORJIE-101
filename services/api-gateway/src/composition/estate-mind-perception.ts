/**
 * EstateMind PERCEPTION source — composition adapter (Wave 1, B8 keystone).
 *
 * The resident `EstateMind` Slow Loop only emits proactive proposals when its
 * situational model is POPULATED: PERCEIVE folds observations in → ORIENT
 * snapshots them → the standing drives evaluate them → an UNSATISFIED drive
 * formulates a goal → the gated proactive_nudge sink surfaces it. With NO
 * perception wired, the model stays empty, every drive reports SATISFIED, and
 * the loop emits ZERO nudges. THIS module is the missing sensor: it reads the
 * six domain measurements the six default drives evaluate from the existing
 * estate tables and returns them as `RecordEntityInput` observations the
 * `SituationalModel.observe()` fold turns into situational entities.
 *
 * WHY HERE (not the kernel): the central-intelligence kernel is deliberately
 * dependency-light — it MUST NOT import `@borjie/database`. This adapter binds
 * the kernel's `PerceptionSource` port to the live Drizzle estate tables, so it
 * belongs at the api-gateway composition root alongside `estate-mind-wiring.ts`
 * (which already binds the Drizzle situational-model store + the gated sink).
 *
 * SIX TABLE → MEASUREMENT MAPPINGS (each → one drive's domain attribute):
 *   cash       → `forecasts`(metric='cash_runway_d')  → { runwayDays }
 *   licence    → `licences`(status='active')           → { renewalInDays }
 *   safety     → `incidents`(open-ish) grouped by site → { openIncidents }
 *   offtake    → `offtake_agreements`                  → { offtakeCoverageRatio }
 *   arrears    → `licence_events`(payment_due overdue) → { overdueDays }
 *   equipment  → `assets`                              → { healthScore }
 *
 * HARD RAILS
 * ──────────
 *   - TENANT-SCOPED READS ONLY. Every query carries an explicit
 *     `tenant_id = ${tenantId}` predicate AND runs inside
 *     `withServiceRoleContext` (the out-of-band heartbeat has no request
 *     middleware to bind the GUC; RLS FORCE still isolates every other caller).
 *   - DEGRADE GRACEFULLY. A missing table / metric / column yields NO
 *     observation for that drive (the drive then reports SATISFIED — we never
 *     raise a concern from absent data) — it NEVER throws to the tick.
 *   - PURE DATA. This source never proposes, never actuates, never reaches a
 *     client. It is read-only sensor glue.
 *   - No `console.*` (Pino shim only). No secrets. Immutable (frozen inputs).
 */

import { sql } from 'drizzle-orm';
import { situationalModel as situationalModelKernel } from '@borjie/central-intelligence';
import { estateMind as estateMindKernel } from '@borjie/central-intelligence';
import { motivation as motivationKernel } from '@borjie/central-intelligence';
import {
  withServiceRoleContext,
  type createDatabaseClient,
} from '@borjie/database';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// `DatabaseClient` collides with a drizzle-orm/postgres-js namespace
// declaration when imported by name (TS2709). Derive it from the factory
// return — the same pattern estate-mind-wiring.ts uses.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

type RecordEntityInput = situationalModelKernel.RecordEntityInput;
type PerceptionSource = estateMindKernel.PerceptionSource;
type DriveThresholds = motivationKernel.DriveThresholds;
type SituationKind = situationalModelKernel.SituationEntityKind;

/** Narrow structural db seam — only `execute(sql)` is needed (test-double-able). */
interface DbExecLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * The service-role wrapper is injected so this module never imports the heavy
 * `@borjie/database` transaction machinery directly into its type surface (the
 * collision the wiring module documents). The composition root passes the real
 * `withServiceRoleContext`; tests pass an identity wrapper over the fake db.
 */
export interface ServiceRoleRunner {
  <T>(fn: (tx: DbExecLike) => Promise<T>): Promise<T>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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
  return null;
}

function strOf(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** Whole days from `nowMs` until `dateLike` (negative once past). */
function daysUntil(dateLike: unknown, nowMs: number): number | null {
  if (dateLike == null) return null;
  const t =
    dateLike instanceof Date
      ? dateLike.getTime()
      : Date.parse(strOf(dateLike));
  if (!Number.isFinite(t)) return null;
  return Math.round((t - nowMs) / MS_PER_DAY);
}

/** Whole days SINCE `dateLike` (0 when in the future). */
function daysSince(dateLike: unknown, nowMs: number): number | null {
  const until = daysUntil(dateLike, nowMs);
  if (until === null) return null;
  return Math.max(0, -until);
}

/** Map an asset lifecycle status to a [0,1] health score (excluded → null). */
function assetHealthScore(status: string): number | null {
  switch (status) {
    case 'operational':
      return 1;
    case 'under_maintenance':
      return 0.4;
    case 'broken':
      return 0;
    // sold / retired assets are not "rotting" — they leave the fleet, no signal.
    default:
      return null;
  }
}

/**
 * Conservative entity_type → situational kind map; unmapped → null (skip).
 *
 * A surprise reconciliation can only DECORATE an entity the loop already
 * tracks, so the seventh perceiver maps a prediction's free-text
 * `action_target_entity_type` onto one of the closed situational kinds — and
 * SKIPS anything that doesn't map (a fabricated `surprise` kind would break the
 * enum; honest-degrade = no observation for an unmapped type).
 */
function surpriseKindFor(entityType: string): SituationKind | null {
  const t = entityType.trim().toLowerCase();
  if (t.includes('licen')) return 'licence';
  if (
    t.includes('supplier') ||
    t.includes('buyer') ||
    t.includes('offtake') ||
    t.includes('off_take') ||
    t.includes('counterparty') ||
    t.includes('vendor')
  ) {
    return 'counterparty';
  }
  if (
    t.includes('asset') ||
    t.includes('equipment') ||
    t.includes('machine') ||
    t.includes('fleet')
  ) {
    return 'equipment';
  }
  if (
    t.includes('cash') ||
    t.includes('treasury') ||
    t.includes('runway') ||
    t.includes('forecast')
  ) {
    return 'cash';
  }
  if (
    t.includes('royalty') ||
    t.includes('receivable') ||
    t.includes('arrear') ||
    t.includes('payment') ||
    t.includes('filing')
  ) {
    return 'arrears';
  }
  if (t.includes('site') || t.includes('pit') || t.includes('incident') || t.includes('safety')) {
    return 'site';
  }
  return null;
}

export interface EstateMindPerceptionDeps {
  readonly db: DbExecLike | null;
  /** Binds the tenant/service-role GUC around each read (RLS-safe). */
  readonly runServiceRole: ServiceRoleRunner;
  readonly logger?: PinoLikeLogger;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

/**
 * Build the live `PerceptionSource` over the estate tables. The composition
 * root injects `serviceRegistry.db` + the real `withServiceRoleContext`; the
 * chokepoint then wires the returned source into the EstateMind supervisor.
 *
 * Returns a source whose `perceive({ tenantId, nowMs })` reads the six domain
 * measurements for THAT tenant and returns `RecordEntityInput[]`. Each of the
 * six readers is independently wrapped: one failing table degrades only its own
 * drive (no observation) and never aborts the others or throws to the tick.
 */
export function createEstateMindPerception(
  deps: EstateMindPerceptionDeps,
): PerceptionSource {
  const logger = deps.logger ?? createPinoLikeLogger('estate-mind-perception');
  const now = deps.now ?? (() => Date.now());

  /** Run one reader; a fault degrades to `[]` (no observation), never throws. */
  async function safely(
    drive: string,
    tenantId: string,
    read: (db: DbExecLike) => Promise<ReadonlyArray<RecordEntityInput>>,
  ): Promise<ReadonlyArray<RecordEntityInput>> {
    if (!deps.db) return [];
    try {
      return await deps.runServiceRole(async (tx) => read(tx));
    } catch (err) {
      logger.warn(
        { tenantId, drive, err: err instanceof Error ? err.message : String(err) },
        'estate-mind-perception: reader degraded (no observation)',
      );
      return [];
    }
  }

  // ── cash → runwayDays (forecasts.metric='cash_runway_d', latest mid) ──────
  async function perceiveCash(
    db: DbExecLike,
    tenantId: string,
  ): Promise<ReadonlyArray<RecordEntityInput>> {
    const res = await db.execute(sql`
      SELECT scope_id, mid, low, computed_at
        FROM forecasts
       WHERE tenant_id = ${tenantId}
         AND metric = 'cash_runway_d'
       ORDER BY computed_at DESC
       LIMIT 1
    `);
    const row = rowsOf(res)[0];
    if (!row) return [];
    // Prefer the central estimate; fall back to the conservative low bound.
    const runwayDays = numOf(row.mid) ?? numOf(row.low);
    if (runwayDays === null) return [];
    const scopeId = strOf(row.scope_id) || 'estate';
    return [
      Object.freeze({
        tenantId,
        entityId: scopeId,
        kind: 'cash' as const,
        label: 'Cash runway',
        attributes: Object.freeze({ runwayDays }),
      }),
    ];
  }

  // ── licence → renewalInDays (licences.expiry_date, active only) ───────────
  async function perceiveLicences(
    db: DbExecLike,
    tenantId: string,
    nowMs: number,
  ): Promise<ReadonlyArray<RecordEntityInput>> {
    const res = await db.execute(sql`
      SELECT id, number, mineral, expiry_date
        FROM licences
       WHERE tenant_id = ${tenantId}
         AND status = 'active'
         AND expiry_date IS NOT NULL
    `);
    const out: RecordEntityInput[] = [];
    for (const row of rowsOf(res)) {
      const renewalInDays = daysUntil(row.expiry_date, nowMs);
      if (renewalInDays === null) continue;
      const id = strOf(row.id);
      if (!id) continue;
      const label = `Licence ${strOf(row.number) || id}`;
      out.push(
        Object.freeze({
          tenantId,
          entityId: id,
          kind: 'licence' as const,
          label,
          attributes: Object.freeze({ renewalInDays }),
        }),
      );
    }
    return out;
  }

  // ── safety → openIncidents (incidents open-ish, grouped by site) ──────────
  async function perceiveSafety(
    db: DbExecLike,
    tenantId: string,
  ): Promise<ReadonlyArray<RecordEntityInput>> {
    const res = await db.execute(sql`
      SELECT COALESCE(site_id, '__estate__') AS site_id, COUNT(*) AS open_count
        FROM incidents
       WHERE tenant_id = ${tenantId}
         AND status IN ('open', 'under_investigation', 'escalated_to_OSHA')
       GROUP BY COALESCE(site_id, '__estate__')
    `);
    const out: RecordEntityInput[] = [];
    for (const row of rowsOf(res)) {
      const openIncidents = numOf(row.open_count);
      if (openIncidents === null) continue;
      const siteId = strOf(row.site_id) || '__estate__';
      out.push(
        Object.freeze({
          tenantId,
          entityId: siteId,
          kind: 'site' as const,
          label: siteId === '__estate__' ? 'Estate (no site)' : `Site ${siteId}`,
          attributes: Object.freeze({ openIncidents }),
        }),
      );
    }
    return out;
  }

  // ── offtake → offtakeCoverageRatio (offtake_agreements signed / total) ────
  async function perceiveOfftake(
    db: DbExecLike,
    tenantId: string,
  ): Promise<ReadonlyArray<RecordEntityInput>> {
    // Estate-level coverage = signed contracted volume ÷ total contracted
    // volume. Unsigned (pending_signature) tonnes are UNCOVERED supply, so a
    // backlog of unsigned agreements drives the ratio below the floor.
    const res = await db.execute(sql`
      SELECT
        COALESCE(SUM(quantity_kg), 0) AS total_kg,
        COALESCE(SUM(quantity_kg) FILTER (WHERE status = 'signed'), 0) AS signed_kg
        FROM offtake_agreements
       WHERE tenant_id = ${tenantId}
         AND deleted_at IS NULL
    `);
    const row = rowsOf(res)[0];
    if (!row) return [];
    const totalKg = numOf(row.total_kg);
    const signedKg = numOf(row.signed_kg);
    // No agreements at all → no signal (an estate with no offtake book is not a
    // coverage BREACH; that is an absence, not a concern).
    if (totalKg === null || totalKg <= 0) return [];
    const offtakeCoverageRatio = (signedKg ?? 0) / totalKg;
    return [
      Object.freeze({
        tenantId,
        entityId: 'estate',
        kind: 'counterparty' as const,
        label: 'Off-take book',
        attributes: Object.freeze({ offtakeCoverageRatio }),
      }),
    ];
  }

  // ── arrears → overdueDays (licence_events payment_due, open + past due) ────
  async function perceiveArrears(
    db: DbExecLike,
    tenantId: string,
    nowMs: number,
  ): Promise<ReadonlyArray<RecordEntityInput>> {
    const res = await db.execute(sql`
      SELECT id, licence_id, due_date
        FROM licence_events
       WHERE tenant_id = ${tenantId}
         AND kind = 'payment_due'
         AND status = 'open'
         AND due_date IS NOT NULL
         AND due_date < now()
    `);
    const out: RecordEntityInput[] = [];
    for (const row of rowsOf(res)) {
      const overdueDays = daysSince(row.due_date, nowMs);
      if (overdueDays === null || overdueDays <= 0) continue;
      const id = strOf(row.id);
      if (!id) continue;
      out.push(
        Object.freeze({
          tenantId,
          entityId: id,
          kind: 'arrears' as const,
          label: `Overdue payment ${id}`,
          attributes: Object.freeze({ overdueDays }),
        }),
      );
    }
    return out;
  }

  // ── equipment → healthScore (assets lifecycle status) ─────────────────────
  async function perceiveEquipment(
    db: DbExecLike,
    tenantId: string,
  ): Promise<ReadonlyArray<RecordEntityInput>> {
    const res = await db.execute(sql`
      SELECT id, kind, make, model, status
        FROM assets
       WHERE tenant_id = ${tenantId}
         AND status NOT IN ('sold', 'retired')
    `);
    const out: RecordEntityInput[] = [];
    for (const row of rowsOf(res)) {
      const healthScore = assetHealthScore(strOf(row.status));
      if (healthScore === null) continue;
      const id = strOf(row.id);
      if (!id) continue;
      const descriptor =
        [strOf(row.make), strOf(row.model)].filter(Boolean).join(' ') ||
        strOf(row.kind) ||
        'asset';
      out.push(
        Object.freeze({
          tenantId,
          entityId: id,
          kind: 'equipment' as const,
          label: `Asset ${descriptor}`,
          attributes: Object.freeze({ healthScore }),
        }),
      );
    }
    return out;
  }

  // ── surprise → surpriseDrift (freshest DIVERGENT outcome_reconciliations) ──
  // Predictive coding / active inference: the MD should attend FIRST to what
  // most defied its own forecast. This seventh perceiver reads the freshest
  // high-drift reconciliations (joined to outcome_predictions for the target
  // entity_type/id) and folds each onto the SAME `kind:entityId` the six domain
  // perceivers use — so the situational fold MERGES the surprise onto the live
  // entity, raising its ACT-R recency term AND decorating it with the drift.
  // The `forecast-surprise` drive then fires on it, and the ORIENT snapshot's
  // most-salient entity becomes the most-surprising one. Unmapped entity_types
  // are skipped (no fabricated kind); a missing table degrades to no observation.
  async function perceiveSurprise(
    db: DbExecLike,
    tenantId: string,
  ): Promise<ReadonlyArray<RecordEntityInput>> {
    const res = await db.execute(sql`
      SELECT
        r.drift_score        AS drift_score,
        r.reconciled_at      AS reconciled_at,
        p.action_target_entity_type AS entity_type,
        p.action_target_entity_id   AS entity_id,
        p.predicted_outcome  AS predicted_outcome,
        p.action_kind        AS action_kind
        FROM outcome_reconciliations r
        JOIN outcome_predictions p
          ON p.id = r.prediction_id
         AND p.tenant_id = r.tenant_id
       WHERE r.tenant_id = ${tenantId}
         AND r.status = 'divergent'
       ORDER BY r.reconciled_at DESC
       LIMIT 20
    `);
    const out: RecordEntityInput[] = [];
    const seen = new Set<string>();
    for (const row of rowsOf(res)) {
      const surpriseDrift = numOf(row.drift_score);
      if (surpriseDrift === null || surpriseDrift <= 0) continue;
      const kind = surpriseKindFor(strOf(row.entity_type));
      if (kind === null) continue;
      const entityId = strOf(row.entity_id);
      if (!entityId) continue;
      // Coalesce to the freshest reconciliation per entity (ORDER BY desc above).
      const dedupeKey = `${kind}:${entityId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(
        Object.freeze({
          tenantId,
          entityId,
          kind,
          label: `Forecast surprise (${strOf(row.action_kind) || strOf(row.entity_type) || 'outcome'})`,
          // Surprise rides the EXISTING attributes bag — no schema change. The
          // fold MERGES this onto the entity the six domain perceivers wrote.
          attributes: Object.freeze({
            surpriseDrift,
            predicted: row.predicted_outcome ?? null,
            // `observed` is reconstructed downstream from the learning signal;
            // we carry the prediction side here (the divergence is the signal).
          }),
        }),
      );
    }
    return out;
  }

  return {
    async perceive({ tenantId, nowMs }): Promise<ReadonlyArray<RecordEntityInput>> {
      if (!tenantId || !deps.db) return [];
      const at = Number.isFinite(nowMs) ? nowMs : now();
      // Each reader is independently wrapped — one bad table degrades only its
      // own drive's observation, never the others, and never throws.
      const batches = await Promise.all([
        safely('cash', tenantId, (db) => perceiveCash(db, tenantId)),
        safely('licence', tenantId, (db) => perceiveLicences(db, tenantId, at)),
        safely('safety', tenantId, (db) => perceiveSafety(db, tenantId)),
        safely('offtake', tenantId, (db) => perceiveOfftake(db, tenantId)),
        safely('arrears', tenantId, (db) => perceiveArrears(db, tenantId, at)),
        safely('equipment', tenantId, (db) => perceiveEquipment(db, tenantId)),
        safely('surprise', tenantId, (db) => perceiveSurprise(db, tenantId)),
      ]);
      return Object.freeze(batches.flat());
    },
  };
}

/**
 * Composition-root convenience: build the live perception source bound to the
 * REAL `withServiceRoleContext` over `serviceRegistry.db`. The chokepoint wave
 * calls THIS one-liner and injects the result into the EstateMind supervisor
 * (`perception:`). Returns a no-op source (always `[]`) when `db` is null so the
 * supervisor stays a safe no-op without it.
 */
export function createEstateMindPerceptionFromDb(
  db: (DatabaseClient & DbExecLike) | null,
  logger: PinoLikeLogger = createPinoLikeLogger('estate-mind-perception'),
): PerceptionSource {
  return createEstateMindPerception({
    db,
    logger,
    runServiceRole: db
      ? (fn) => withServiceRoleContext(db, (tx) => fn(tx as unknown as DbExecLike))
      : (fn) => fn({ async execute() { return []; } }),
  });
}

// ---------------------------------------------------------------------------
// Schema-conditioned drives — per-tenant DriveThresholds from consolidated
// `baseline:*` semantic facts (Memory Consolidation & Schema Formation).
// ---------------------------------------------------------------------------

/**
 * Standard-deviation multiplier for the anomaly band: a metric is "worth a
 * look" when it crosses `mean ± k·sd` for THIS estate. k = 1.5 is a moderate
 * 1.5-sigma band (≈ the worst-13% tail) — tunable later, never hard-coded at a
 * call site beyond this single default.
 */
const BASELINE_SIGMA_K = 1.5;

/**
 * Which `baseline:${scope}:${metric}` facts re-tune which DriveThreshold, and
 * in which direction the anomaly band points. FLOOR concerns (cash runway,
 * licence lead-time, off-take coverage, equipment health) fire when a value
 * drops, so their threshold is `mean − k·sd`. CEILING concerns (open
 * incidents, overdue royalty days) fire when a value rises, so their threshold
 * is `mean + k·sd`. The metric token is matched case-insensitively against the
 * fact key so a `baseline:estate:cash_runway_d` fact tunes the cash floor.
 */
type BaselineDirection = 'floor' | 'ceiling';
interface BaselineBinding {
  readonly metricTokens: ReadonlyArray<string>;
  readonly thresholdKey: keyof Required<DriveThresholds>;
  readonly direction: BaselineDirection;
}

const BASELINE_BINDINGS: ReadonlyArray<BaselineBinding> = Object.freeze([
  { metricTokens: ['cash_runway', 'runway'], thresholdKey: 'cashRunwayDaysFloor', direction: 'floor' },
  { metricTokens: ['licence_renewal', 'renewal'], thresholdKey: 'licenceRenewalDaysFloor', direction: 'floor' },
  { metricTokens: ['open_incidents', 'incidents', 'safety'], thresholdKey: 'safetyOpenIncidentsCeiling', direction: 'ceiling' },
  { metricTokens: ['offtake_coverage', 'coverage'], thresholdKey: 'offtakeCoverageRatioFloor', direction: 'floor' },
  { metricTokens: ['royalty_overdue', 'overdue', 'arrears'], thresholdKey: 'royaltyOverdueDaysCeiling', direction: 'ceiling' },
  { metricTokens: ['equipment_health', 'health'], thresholdKey: 'equipmentHealthScoreFloor', direction: 'floor' },
]);

/** Pull a finite `mean` and `sd` out of a baseline fact's jsonb value. */
function meanSdOf(value: unknown): { mean: number; sd: number } | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const mean = numOf(v.mean ?? v.avg ?? v.average ?? v.mu);
  if (mean === null) return null;
  const sd = numOf(v.sd ?? v.stddev ?? v.std ?? v.sigma) ?? 0;
  return { mean, sd: Math.max(0, sd) };
}

/**
 * Resolve per-tenant {@link DriveThresholds} from the consolidated baseline
 * schema the sleep pass writes as `baseline:${scope}:${metric}` semantic facts.
 * This closes the SECOND half of the consolidation loop: sleep WRITES the
 * baseline (what is normal for THIS estate), the waking slow loop READS it to
 * decide what counts as a breach — so nudges fire on what is anomalous for this
 * estate, not a global static floor.
 *
 * For every metric that has a `baseline:*` fact the threshold becomes
 * `mean ± k·sd`; metrics with NO baseline fact are simply OMITTED from the
 * returned object so the drive falls back to its built-in `DEFAULT_DRIVE_THRESHOLDS`
 * default (the `thresholds.X ?? DEFAULT` injection points already in the drives).
 * An absent table / empty result / read fault degrades to `{}` (every drive uses
 * its static default) and NEVER throws to the caller.
 *
 * DEP (designTier): this consumes the estate-baseline sleep pass. Until that
 * pass writes `baseline:*` facts, this resolver returns `{}` and the loop runs
 * on the static defaults — honest-degrade, no fabricated baselines.
 */
export async function resolveDriveThresholdsFromBaselines(
  db: DbExecLike | null,
  tenantId: string,
  opts: { readonly runServiceRole?: ServiceRoleRunner; readonly sigmaK?: number } = {},
  logger: PinoLikeLogger = createPinoLikeLogger('estate-mind-thresholds'),
): Promise<DriveThresholds> {
  if (!db || !tenantId) return Object.freeze({});
  const k = Number.isFinite(opts.sigmaK) ? (opts.sigmaK as number) : BASELINE_SIGMA_K;
  const run: ServiceRoleRunner = opts.runServiceRole ?? ((fn) => fn(db));
  try {
    const rows = await run(async (tx) => {
      const res = await tx.execute(sql`
        SELECT key, value
          FROM kernel_memory_semantic
         WHERE tenant_id = ${tenantId}
           AND user_id IS NULL
           AND key LIKE 'baseline:%'
      `);
      return rowsOf(res);
    });
    if (rows.length === 0) return Object.freeze({});
    const thresholds: Record<string, number> = {};
    for (const row of rows) {
      const key = strOf(row.key).toLowerCase();
      const stats = meanSdOf(row.value);
      if (!stats) continue;
      for (const binding of BASELINE_BINDINGS) {
        if (binding.thresholdKey in thresholds) continue; // first match wins
        const hit = binding.metricTokens.some((tok) => key.includes(tok));
        if (!hit) continue;
        const band =
          binding.direction === 'floor'
            ? stats.mean - k * stats.sd
            : stats.mean + k * stats.sd;
        // Floors can't go below 0; ceilings can't either. Round day-based
        // metrics to whole days; ratios/scores stay fractional.
        thresholds[binding.thresholdKey] = Math.max(0, band);
      }
    }
    return Object.freeze({ ...thresholds }) as DriveThresholds;
  } catch (err) {
    logger.warn(
      { tenantId, err: err instanceof Error ? err.message : String(err) },
      'estate-mind-thresholds: baseline resolve degraded → static defaults',
    );
    return Object.freeze({});
  }
}

/**
 * Composition-root convenience: resolve the per-tenant schema-conditioned
 * thresholds bound to the REAL `withServiceRoleContext`. The supervisor reads
 * these BEFORE evaluating drives so a breach is judged against THIS estate's
 * consolidated baseline. Returns `{}` (static defaults) when `db` is null or no
 * `baseline:*` facts exist yet — honest-degrade.
 */
export function resolveDriveThresholdsFromBaselinesDb(
  db: (DatabaseClient & DbExecLike) | null,
  tenantId: string,
  logger: PinoLikeLogger = createPinoLikeLogger('estate-mind-thresholds'),
): Promise<DriveThresholds> {
  if (!db) return Promise.resolve(Object.freeze({}));
  return resolveDriveThresholdsFromBaselines(
    db,
    tenantId,
    {
      runServiceRole: (fn) =>
        withServiceRoleContext(db, (tx) => fn(tx as unknown as DbExecLike)),
    },
    logger,
  );
}
