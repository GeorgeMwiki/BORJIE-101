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
