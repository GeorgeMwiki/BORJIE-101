/**
 * Proactive-intel TickInputs provider — W3a (the live per-tenant DATA FEED).
 *
 * The proactive-intel worker (`workers/proactive-intel.worker.ts`, lit in wave
 * 2) drives the previously-DARK `@borjie/proactive-intel` detectors, but its
 * `inputsForTenant` seam was left unwired — so the worker warned ONCE on boot
 * then idled: the detectors got no data and surfaced no insight. This module is
 * that seam. For one tenant it assembles the LIVE `TickInputs` the SHIPPED
 * detectors read.
 *
 * GENERATIVE, not per-case: the detectors are pure (no I/O), so ALL fetching
 * lives behind one narrow, bounded SQL port — the SAME `$client.unsafe(sql,
 * params)` boundary the portal-genui record store + widget-data resolver use
 * (`portal-genui-wiring.ts#makeDbExecutor`). Each slice is one parameterised,
 * tenant-scoped `SELECT … LIMIT N` against a VERIFIED real table:
 *
 *   - cashflow         → latest `cash_balances` (balance now) + a `forecasts`
 *                        `cash_runway_d` band → the `CashflowForecastSlice`
 *                        `detectCashflowDip` reads.
 *   - royaltyArrears   → weekly count of `sales` with `payment_status='pending'`
 *                        and a positive `royalty_pct` → the
 *                        `RoyaltyArrearsSeries` `detectRoyaltyArrearsSpike` reads.
 *   - customerOwners   → per-buyer engagement / lateness signal from `buyers`
 *                        + their recent `sales` → the `CustomerOwnerSignal[]`
 *                        `detectChurnRisk` reads.
 *
 * We map ONLY the three slices the wired registry consumes
 * (`scheduler/detector-registry.ts`). The four scaffolded-but-unwired detectors
 * (cost / slo / compliance / vendor) get NO input — their kinds are skipped by
 * the runner's `if (!fn) continue;`, so feeding them would be dead work.
 *
 * Fail-safe by construction: a slice whose source is empty (or whose query
 * throws) returns its NEUTRAL default — an absent field, or an empty series the
 * detector self-skips on (`if (!cashflow) return []`, `weeks.length < 5`, empty
 * `customerOwners`). A neutral default never fabricates a signal and never
 * crashes the tick; a query fault degrades that ONE slice + emits a pino warn,
 * the rest of the tenant's inputs still assemble. No `process.env`, pino-shaped
 * logger injected, RLS FORCE (`app.current_tenant_id`) is the DB-side backstop —
 * the tenant predicate here is defence-in-depth, never the only guard.
 */

import { z } from 'zod';

import type {
  TickInputs,
  CashflowForecastSlice,
  ForecastBand,
  RoyaltyArrearsSeries,
  RoyaltyArrearsTimePoint,
  CustomerOwnerSignal,
} from '@borjie/proactive-intel';

import type { ProactiveIntelInputsProvider } from '../../workers/proactive-intel.worker.js';

// ────────────────────────────────────────────────────────────────────
// Ports
// ────────────────────────────────────────────────────────────────────

/**
 * Narrow Postgres read port — the SAME `query(sql, params)` boundary
 * `portal-genui-wiring.ts` builds from Drizzle's `$client.unsafe`. Re-declared
 * here (rather than importing `DbExecutor`) so this module depends on nothing
 * heavier than this signature; the integration site adapts `$client.unsafe`.
 */
export interface TickInputsQueryPort {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<Row>>;
}

/**
 * Structural pino-shaped logger. Satisfied by both the api-gateway `logger` util
 * and pino (the `(meta, message)` argument order). Declared here so the module
 * depends on no logging package — mirrors `widget-data-resolver.ts`.
 */
export interface TickInputsLogger {
  warn(meta: Record<string, unknown>, message: string): void;
}

export interface TickInputsProviderDeps {
  /** Tenant-scoped read port. Omitted → every slice degrades to neutral. */
  readonly query?: TickInputsQueryPort;
  readonly logger: TickInputsLogger;
  /**
   * How many cash-balance / forecast / sales / buyer rows to scan per tenant
   * per tick — the bound that keeps one tenant's read cheap. Clamped 1..1000.
   */
  readonly rowLimit?: number;
}

// ────────────────────────────────────────────────────────────────────
// Bounds + tunables (constants — never per-case, never user-derived)
// ────────────────────────────────────────────────────────────────────

const DEFAULT_ROW_LIMIT = 200;
const MAX_ROW_LIMIT = 1000;
/** Royalty-arrears baseline window the spike detector needs: 4 prior + latest. */
const ARREARS_WEEKS = 6;
/** Max buyers scored for churn per tenant per tick (bounded fan-out). */
const CHURN_BUYER_LIMIT = 200;
/** Forecast bands kept for the cashflow slice (one bounded horizon series). */
const FORECAST_BAND_LIMIT = 60;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clampRowLimit(value: number | undefined): number {
  const candidate =
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : DEFAULT_ROW_LIMIT;
  return Math.min(MAX_ROW_LIMIT, Math.max(1, candidate));
}

// ────────────────────────────────────────────────────────────────────
// Row coercion — every DB value is parsed through zod before it shapes a
// detector input, so a malformed/null column degrades to a neutral number
// instead of NaN-poisoning a detector. numeric() comes back as a string from
// postgres-js, so we coerce.
// ────────────────────────────────────────────────────────────────────

const finiteNumber = z.coerce.number().refine(Number.isFinite, 'not finite');
const safeNumber = finiteNumber.catch(0);
const safeNonNegInt = z.coerce
  .number()
  .refine(Number.isFinite, 'not finite')
  .transform((n) => Math.max(0, Math.round(n)))
  .catch(0);

/** Coerce a timestamp-ish column (Date | ISO string | epoch ms) to epoch ms. */
function toEpochMs(value: unknown, fallback: number): number {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : fallback;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : fallback;
  }
  return fallback;
}

// ────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────

export function createTickInputsProvider(
  deps: TickInputsProviderDeps,
): ProactiveIntelInputsProvider {
  const { query, logger } = deps;
  const rowLimit = clampRowLimit(deps.rowLimit);

  /**
   * cashflow slice — `detectCashflowDip` reads `cashBalanceNow`, `safetyFloor`
   * and a `bands` series of `{ t, p10, p50, p90 }`. We source the balance from
   * the latest `cash_balances` row and the band series + floor from the tenant's
   * `forecasts` `cash_runway_d` rows. NEUTRAL: no balance → undefined slice
   * (detector self-skips); balance but no forecast bands → an EMPTY `bands`
   * array (the detector returns [] on `bands.length === 0`) — a present balance
   * is never a fabricated dip.
   */
  async function loadCashflow(
    tenantId: string,
    nowMs: number,
  ): Promise<CashflowForecastSlice | undefined> {
    if (!query) return undefined;
    try {
      const balRows = await query.query<Record<string, unknown>>(
        `SELECT balance_tzs
           FROM public.cash_balances
          WHERE tenant_id = $1
          ORDER BY recorded_at DESC
          LIMIT 1`,
        [tenantId],
      );
      if (balRows.length === 0) return undefined; // no treasury signal → no slice
      const cashBalanceNow = safeNumber.parse(balRows[0]?.balance_tzs);

      // Forecast bands — tenant-scoped cash forecast. Each row carries a
      // low/mid/high triple over a horizon; we map them onto p10/p50/p90 bands
      // spaced one day apart from `now`. Absent rows → empty bands → no dip.
      const fcRows = await query.query<Record<string, unknown>>(
        `SELECT low, mid, high, horizon_days
           FROM public.forecasts
          WHERE tenant_id = $1
            AND metric = 'cash_runway_d'
          ORDER BY computed_at DESC, horizon_days ASC
          LIMIT $2`,
        [tenantId, FORECAST_BAND_LIMIT],
      );

      const bands: ForecastBand[] = fcRows.map((r) => {
        const p50 = safeNumber.parse(r.mid);
        const p10 = safeNumber.parse(r.low);
        const p90 = safeNumber.parse(r.high);
        const horizonDays = safeNonNegInt.parse(r.horizon_days);
        return {
          t: nowMs + horizonDays * MS_PER_DAY,
          p10,
          p50,
          // Guard ordering so a malformed triple never inverts the band.
          p90: Math.max(p90, p50, p10),
        };
      });

      // Safety floor: a tenant-set "do not dip below" line. We do not invent
      // one — when no forecast exists there are no bands, so the floor is inert
      // (the detector never runs). When bands exist we anchor the floor at 0
      // (cash should not go negative); a richer per-tenant floor is a later seam.
      const safetyFloor = 0;

      return {
        tenantId,
        cashBalanceNow,
        horizonDays: bands.length,
        bands,
        safetyFloor,
      };
    } catch (err) {
      warnSlice(logger, tenantId, 'cashflow', err);
      return undefined;
    }
  }

  /**
   * royaltyArrears slice — `detectRoyaltyArrearsSpike` reads a weekly
   * `arrearsCount` series and needs ≥5 weeks. We count `sales` rows with a
   * positive `royalty_pct` still `payment_status = 'pending'`, bucketed by the
   * sale week, over the trailing `ARREARS_WEEKS`. NEUTRAL: fewer than 5 weeks of
   * data → an empty/short series the detector self-skips on — never a fabricated
   * spike.
   */
  async function loadRoyaltyArrears(
    tenantId: string,
    nowMs: number,
  ): Promise<RoyaltyArrearsSeries | undefined> {
    if (!query) return undefined;
    try {
      // Aggregate in SQL by truncated week so the row count is bounded by the
      // window, not by sales volume. `date_trunc` keys the bucket; we emit one
      // point per week present.
      const rows = await query.query<Record<string, unknown>>(
        `SELECT date_trunc('week', ts) AS week_start,
                COUNT(*)               AS arrears_count
           FROM public.sales
          WHERE tenant_id = $1
            AND payment_status = 'pending'
            AND royalty_pct IS NOT NULL
            AND royalty_pct > 0
            AND ts >= $2
          GROUP BY 1
          ORDER BY 1 ASC
          LIMIT $3`,
        [tenantId, new Date(nowMs - ARREARS_WEEKS * MS_PER_WEEK).toISOString(), ARREARS_WEEKS + 2],
      );

      const weeks: RoyaltyArrearsTimePoint[] = rows.map((r) => ({
        weekStartMs: toEpochMs(r.week_start, nowMs),
        arrearsCount: safeNonNegInt.parse(r.arrears_count),
      }));

      // Even with zero rows we return the (empty) series rather than undefined;
      // the detector's `weeks.length < MIN_BASELINE_WEEKS + 1` guard then
      // self-skips. Either path is a safe no-fire.
      return { tenantId, weeks };
    } catch (err) {
      warnSlice(logger, tenantId, 'royaltyArrears', err);
      return undefined;
    }
  }

  /**
   * customerOwners slice — `detectChurnRisk` scores each `CustomerOwnerSignal`
   * on engagement-decline + complaints + payment-lateness. For a mining tenant
   * the "customer-owners" are its BUYERS. We derive each buyer's signal from its
   * recent `sales`: engagement = sale recency vs the prior window, lateness =
   * days a pending sale has sat unpaid. We have no complaints feed yet, so
   * `complaintCount30d` is a NEUTRAL 0 (one absent metric simply lowers the
   * score — never fabricates risk). NEUTRAL whole-slice: no buyers → empty array
   * → detector emits nothing.
   */
  async function loadCustomerOwners(
    tenantId: string,
    nowMs: number,
  ): Promise<ReadonlyArray<CustomerOwnerSignal> | undefined> {
    if (!query) return undefined;
    try {
      const windowStartMs = nowMs - 30 * MS_PER_DAY;
      const priorStartMs = nowMs - 60 * MS_PER_DAY;
      // One bounded, tenant-scoped aggregate per buyer over the trailing 60d.
      const rows = await query.query<Record<string, unknown>>(
        `SELECT b.id AS buyer_id,
                COUNT(*) FILTER (WHERE s.ts >= $2)                AS sales_30d,
                COUNT(*) FILTER (WHERE s.ts >= $3 AND s.ts < $2)  AS sales_prior_30d,
                MAX(EXTRACT(EPOCH FROM ($5::timestamptz - s.ts)))
                  FILTER (WHERE s.payment_status = 'pending')      AS oldest_pending_secs
           FROM public.buyers b
           LEFT JOIN public.sales s
             ON s.buyer_id = b.id
            AND s.tenant_id = b.tenant_id
            AND s.ts >= $4
          WHERE b.tenant_id = $1
          GROUP BY b.id
          LIMIT $6`,
        [
          tenantId,
          new Date(windowStartMs).toISOString(),
          new Date(priorStartMs).toISOString(),
          new Date(priorStartMs).toISOString(),
          new Date(nowMs).toISOString(),
          Math.min(CHURN_BUYER_LIMIT, rowLimit),
        ],
      );

      const signals: CustomerOwnerSignal[] = rows.map((r) => {
        const engagement30d = safeNonNegInt.parse(r.sales_30d);
        const priorEngagement = safeNonNegInt.parse(r.sales_prior_30d);
        // Bounded [-1, 1] trend. Falling activity yields a negative delta (the
        // detector reads `-engagementDelta` as risk). A buyer with no prior
        // activity is treated as flat (delta 0) — never auto-flagged.
        const engagementDelta =
          priorEngagement > 0
            ? clampUnit((engagement30d - priorEngagement) / priorEngagement)
            : 0;
        const oldestPendingSecs = Number(r.oldest_pending_secs);
        const latestPaymentLatenessDays = Number.isFinite(oldestPendingSecs)
          ? Math.max(0, oldestPendingSecs / (60 * 60 * 24))
          : 0;
        return {
          customerOwnerId: String(r.buyer_id ?? ''),
          engagement30d,
          engagementDelta,
          // No complaints feed wired yet → neutral 0 (lowers, never raises, risk).
          complaintCount30d: 0,
          latestPaymentLatenessDays,
        };
      });

      return signals.filter((s) => s.customerOwnerId.length > 0);
    } catch (err) {
      warnSlice(logger, tenantId, 'customerOwners', err);
      return undefined;
    }
  }

  return {
    async inputsForTenant(input: {
      readonly tenantId: string;
      readonly nowMs: number;
    }): Promise<TickInputs> {
      const { tenantId, nowMs } = input;

      // No DB wired → every slice is neutral; the worker treats this as a
      // no-signal tick (its detectors self-skip). Never throws.
      if (!query) return {};

      // Assemble each slice independently so one slice's fault cannot drop the
      // others. Each loader already contains its own faults + neutral default.
      const [cashflow, royaltyArrears, customerOwners] = await Promise.all([
        loadCashflow(tenantId, nowMs),
        loadRoyaltyArrears(tenantId, nowMs),
        loadCustomerOwners(tenantId, nowMs),
      ]);

      // Only attach a slice that actually resolved (exactOptionalPropertyTypes:
      // an absent field is the neutral the detector skips on, distinct from a
      // present-but-empty one).
      const inputs: {
        -readonly [K in keyof TickInputs]: TickInputs[K];
      } = {};
      if (cashflow) inputs.cashflow = cashflow;
      if (royaltyArrears) inputs.royaltyArrears = royaltyArrears;
      if (customerOwners) inputs.customerOwners = customerOwners;
      return inputs;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < -1) return -1;
  if (n > 1) return 1;
  return n;
}

function warnSlice(
  logger: TickInputsLogger,
  tenantId: string,
  slice: string,
  err: unknown,
): void {
  logger.warn(
    {
      provider: 'proactive-tick-inputs',
      tenantId,
      slice,
      err: err instanceof Error ? err.message : String(err),
    },
    `proactive-tick-inputs: ${slice} read failed — degrading that slice to neutral`,
  );
}
