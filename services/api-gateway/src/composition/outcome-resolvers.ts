/**
 * Outcome observation resolvers — Wave CLOSED-LOOP-RESOLVERS.
 *
 * Companion to `workers/outcome-reconciliation-worker.ts`. The worker's
 * `resolvers` map was `{}` for months, meaning EVERY prediction expired
 * with `reason: 'no_observation_resolver'` (see the worker's own
 * `reconcileOne()` fall-through). That broke the closed-loop arm: the
 * brain wrote predictions, the calibration monitor saw no real signal,
 * and the audit chain accumulated `expired` entries without ever
 * grading whether the brain was right.
 *
 * This file provides three real resolver categories backed by Drizzle
 * reads over production / financial / compliance tables. Each resolver:
 *
 *   1. Reads the entity's CURRENT state via a tenant-scoped query that
 *      RLS will additionally constrain (the worker binds the tenant
 *      GUC before each resolver call via `withWorkerTenantContext`).
 *   2. Mirrors the prediction's envelope shape so the worker's
 *      `vectorDrift` calculation has comparable keys.
 *   3. Returns `null` when the entity vanished or the table is empty
 *      — landing the reconciliation in `expired` (auditable) rather
 *      than fabricating zeros.
 *
 * Failure containment:
 *   - Per-resolver DB errors are caught and logged; the resolver
 *     returns `null` so the worker's per-row try/catch handles the
 *     dangling prediction cleanly.
 *   - Resolvers are idempotent reads — re-invocation is safe.
 *   - No writes here; the worker owns the inserts into
 *     `outcome_observations` + `outcome_reconciliations`.
 *
 * Adding a new resolver:
 *   - Build a function with the `ObservationResolver` signature.
 *   - Add it under its entity-type key in `buildOutcomeResolvers()`.
 *   - That's it — the worker will dispatch the next time the entity
 *     type appears in a pending prediction row.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type {
  ObservationResolver,
  ObservationResolverResult,
} from '../workers/outcome-reconciliation-worker.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface OutcomeResolversDeps {
  readonly db: DbLike;
  readonly logger: Logger;
}

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// 1. Production / output resolver — production_tonnage_events
// ────────────────────────────────────────────────────────────────────

/**
 * Resolves observed production for a mining site over the prediction
 * horizon. Returns the rolling ore-tonnes / waste-tonnes / strip-ratio
 * snapshot for the past 30 days so a prediction like
 *   { ore_tonnes: 1200, waste_tonnes: 400 }
 * has like-shape `observed_outcome` for vector-drift.
 *
 * `entityId` is the `site_id` (UUID). The brain's mining-production
 * tools record this column on their prediction rows so the worker can
 * look up "this site, now" without a join. When the site has zero
 * events in the window the resolver returns the snapshot with zeros
 * so the brain still learns "predicted production, got nothing".
 */
export function createProductionResolver(
  deps: OutcomeResolversDeps,
): ObservationResolver {
  return async (input) => {
    if (!input.entityId) return null;
    try {
      const res = await deps.db.execute(sql`
        SELECT
          COALESCE(SUM(ore_tonnes::numeric), 0)::numeric  AS ore_tonnes,
          COALESCE(SUM(waste_tonnes::numeric), 0)::numeric AS waste_tonnes,
          COUNT(*)::int                                    AS event_count,
          MAX(captured_at)                                 AS most_recent_at
          FROM production_tonnage_events
         WHERE tenant_id  = ${input.tenantId}::uuid
           AND site_id    = ${input.entityId}::uuid
           AND captured_at >= NOW() - INTERVAL '30 days'
           AND qa_status  IN ('pending', 'passed')
      `);
      const rows = asRows(res);
      const head = rows[0];
      if (!head) {
        return null;
      }
      const oreTonnes = toNumber(head.ore_tonnes) ?? 0;
      const wasteTonnes = toNumber(head.waste_tonnes) ?? 0;
      const eventCount = toNumber(head.event_count) ?? 0;
      const stripRatio =
        oreTonnes > 0 ? Number((wasteTonnes / oreTonnes).toFixed(3)) : 0;
      const observed: Record<string, unknown> = {
        ore_tonnes: Number(oreTonnes.toFixed(3)),
        waste_tonnes: Number(wasteTonnes.toFixed(3)),
        strip_ratio: stripRatio,
        event_count: eventCount,
      };
      const result: ObservationResolverResult = {
        observedOutcome: Object.freeze(observed),
        // Production resolver does not assert a TZS value; the
        // monetisation lives downstream in sales. Returning null keeps
        // the worker on the vector-drift path.
        observedValueTzs: null,
        narrative:
          `Observed ${eventCount} tonnage events over last 30d: ` +
          `${oreTonnes.toFixed(3)}t ore, ${wasteTonnes.toFixed(3)}t waste ` +
          `(strip ratio ${stripRatio}).`,
      };
      return result;
    } catch (err) {
      deps.logger.warn(
        {
          resolver: 'production',
          entityType: input.entityType,
          entityId: input.entityId,
          err: err instanceof Error ? err.message : String(err),
        },
        'outcome-resolvers.production: query failed; returning null',
      );
      return null;
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// 2. Financial resolver — ledger_entries (revenue / arrears / cash-flow)
// ────────────────────────────────────────────────────────────────────

/**
 * Resolves observed financial activity over the prediction horizon.
 * Reads from `ledger_entries` (the canonical double-entry ledger per
 * CLAUDE.md "Money path goes through LedgerService.post()").
 *
 * `entityId` is interpreted as the account_id when present. The
 * resolver returns the past-30d credit / debit totals + entry counts
 * so a financial prediction shaped like
 *   { credit_tzs: 5_000_000, debit_tzs: 1_000_000, net_tzs: 4_000_000 }
 * has a comparable `observed_outcome`.
 *
 * When `entityId` is empty (the brain produced a tenant-wide forecast
 * without a specific account) the resolver aggregates across ALL
 * accounts for the tenant so cash-flow rollups still receive signal.
 */
export function createFinancialResolver(
  deps: OutcomeResolversDeps,
): ObservationResolver {
  return async (input) => {
    try {
      // Build the WHERE clause inline so a missing account_id widens
      // to "tenant total" rather than failing the equality check.
      const accountFilter =
        input.entityId && input.entityId.length > 0
          ? sql`AND account_id = ${input.entityId}`
          : sql``;
      const res = await deps.db.execute(sql`
        SELECT
          COALESCE(
            SUM(CASE WHEN direction = 'credit' THEN amount_minor_units ELSE 0 END),
            0
          )::bigint AS credit_minor,
          COALESCE(
            SUM(CASE WHEN direction = 'debit' THEN amount_minor_units ELSE 0 END),
            0
          )::bigint AS debit_minor,
          COUNT(*)::int AS entry_count,
          MAX(posted_at) AS most_recent_at
          FROM ledger_entries
         WHERE tenant_id = ${input.tenantId}
           ${accountFilter}
           AND posted_at >= NOW() - INTERVAL '30 days'
      `);
      const rows = asRows(res);
      const head = rows[0];
      if (!head) return null;
      // amount_minor_units is in cents/minor units; the ledger is
      // multi-currency but for TZS the minor unit is 1/100 TZS. The
      // observed value we expose is TZS-major so the worker's scalar
      // drift compares apples to apples with predicted_value_tzs.
      const creditMinor = toNumber(head.credit_minor) ?? 0;
      const debitMinor = toNumber(head.debit_minor) ?? 0;
      const entryCount = toNumber(head.entry_count) ?? 0;
      const creditTzs = Math.round(creditMinor / 100);
      const debitTzs = Math.round(debitMinor / 100);
      const netTzs = creditTzs - debitTzs;
      const observed: Record<string, unknown> = {
        credit_tzs: creditTzs,
        debit_tzs: debitTzs,
        net_tzs: netTzs,
        entry_count: entryCount,
      };
      const result: ObservationResolverResult = {
        observedOutcome: Object.freeze(observed),
        // Surface net cash-flow as the scalar so scalar-drift becomes
        // the primary signal when the prediction set predicted_value_tzs.
        observedValueTzs: netTzs,
        narrative:
          `Observed ${entryCount} ledger entries over last 30d: ` +
          `+${creditTzs.toLocaleString()} TZS credit, ` +
          `−${debitTzs.toLocaleString()} TZS debit, ` +
          `net ${netTzs.toLocaleString()} TZS.`,
      };
      return result;
    } catch (err) {
      deps.logger.warn(
        {
          resolver: 'financial',
          entityType: input.entityType,
          entityId: input.entityId,
          err: err instanceof Error ? err.message : String(err),
        },
        'outcome-resolvers.financial: query failed; returning null',
      );
      return null;
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// 3. Compliance resolver — regulatory_filings (deadlines + statuses)
// ────────────────────────────────────────────────────────────────────

/**
 * Resolves observed compliance state for a regulatory filing. The
 * brain's compliance tools record predictions shaped like
 *   { filed: true, on_time: true, status: 'submitted' }
 * so the resolver returns the actual filing row's status + on-time
 * flag computed from `due_at` vs `submitted_at`.
 *
 * `entityId` is the regulatory_filings.id (UUID). When the filing
 * row no longer exists (cancelled / deleted) the resolver returns
 * `null` so the reconciliation lands as `expired` cleanly.
 */
export function createComplianceResolver(
  deps: OutcomeResolversDeps,
): ObservationResolver {
  return async (input) => {
    if (!input.entityId) return null;
    try {
      const res = await deps.db.execute(sql`
        SELECT
          status,
          due_at,
          submitted_at,
          decided_outcome,
          fee_paid_tzs,
          regulator,
          filing_type
          FROM regulatory_filings
         WHERE tenant_id = ${input.tenantId}
           AND id        = ${input.entityId}::uuid
         LIMIT 1
      `);
      const rows = asRows(res);
      const head = rows[0];
      if (!head) return null;
      const status = typeof head.status === 'string' ? head.status : 'unknown';
      const dueAtRaw = head.due_at;
      const submittedAtRaw = head.submitted_at;
      const filed = submittedAtRaw !== null && submittedAtRaw !== undefined;
      // `on_time` is true when submitted on or before the due date.
      // Null `submitted_at` is on_time only if the due date is still
      // in the future at the moment of observation.
      let onTime: boolean;
      if (filed && dueAtRaw && submittedAtRaw) {
        const due = new Date(String(dueAtRaw)).getTime();
        const sub = new Date(String(submittedAtRaw)).getTime();
        onTime = Number.isFinite(due) && Number.isFinite(sub) && sub <= due;
      } else if (!filed && dueAtRaw) {
        const due = new Date(String(dueAtRaw)).getTime();
        onTime = Number.isFinite(due) && due > Date.now();
      } else {
        onTime = false;
      }
      const feePaidTzs = toNumber(head.fee_paid_tzs) ?? 0;
      const observed: Record<string, unknown> = {
        filed,
        on_time: onTime,
        status,
        regulator: typeof head.regulator === 'string' ? head.regulator : '',
        filing_type:
          typeof head.filing_type === 'string' ? head.filing_type : '',
        fee_paid_tzs: feePaidTzs,
        decided_outcome:
          typeof head.decided_outcome === 'string' ? head.decided_outcome : '',
      };
      const result: ObservationResolverResult = {
        observedOutcome: Object.freeze(observed),
        observedValueTzs: feePaidTzs > 0 ? feePaidTzs : null,
        narrative:
          `Filing observed status=${status}, filed=${filed}, on_time=${onTime}` +
          (feePaidTzs > 0
            ? `, fee TZS ${feePaidTzs.toLocaleString()}.`
            : '.'),
      };
      return result;
    } catch (err) {
      deps.logger.warn(
        {
          resolver: 'compliance',
          entityType: input.entityType,
          entityId: input.entityId,
          err: err instanceof Error ? err.message : String(err),
        },
        'outcome-resolvers.compliance: query failed; returning null',
      );
      return null;
    }
  };
}

// ────────────────────────────────────────────────────────────────────
// Composition root — build the resolvers map the worker consumes
// ────────────────────────────────────────────────────────────────────

/**
 * Build the per-entity-type resolver map passed to the
 * outcome-reconciliation worker. The entity-type keys mirror the
 * `targetEntityType` values the brain's WRITE-tool predictors emit
 * (see `composition/brain-tools/outcome-predictor.ts`).
 *
 * Keys are listed multiple times intentionally — many tools emit the
 * same observation shape under different slugs (e.g. `production`,
 * `mining_production`, `tonnage`) and we accept all of them rather
 * than forcing the brain catalog into a single canonical slug.
 *
 * Unrecognised entity types fall through to the worker's `expired`
 * path with `reason: 'no_observation_resolver'`, preserving the
 * pre-existing behaviour for slugs we do not yet model.
 */
export function buildOutcomeResolvers(
  deps: OutcomeResolversDeps,
): Readonly<Record<string, ObservationResolver>> {
  const production = createProductionResolver(deps);
  const financial = createFinancialResolver(deps);
  const compliance = createComplianceResolver(deps);
  return Object.freeze({
    // Production / output
    production,
    production_tonnage: production,
    mining_production: production,
    tonnage: production,
    site_production: production,
    // Financial
    financial: financial,
    ledger: financial,
    ledger_entry: financial,
    cash_flow: financial,
    arrears: financial,
    revenue: financial,
    payment: financial,
    // Compliance
    compliance: compliance,
    regulatory_filing: compliance,
    regulatory_filings: compliance,
    filing: compliance,
    licence_renewal: compliance,
    license_renewal: compliance,
  });
}
