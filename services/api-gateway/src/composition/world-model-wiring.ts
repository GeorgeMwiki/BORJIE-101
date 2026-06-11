/**
 * World-model (R6) composition wiring — un-darks the kernel's
 * forward-simulation organ.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `createWorldModelKernelTools` (packages/central-intelligence/src/kernel/
 * world-model/world-model-tool.ts) ships three agent-loop callable tools —
 *   world.property_trajectory   forward-simulate a site's state vector
 *   world.arrears_trajectory    forecast counterparty outstanding royalties
 *   world.market_regime         classify the estate-level regime
 * — exported + unit-tested but with ZERO composition-root callers. The brain
 * could not forward-simulate mid-turn. This module binds the bundle's three
 * historical-state fetchers to READ-ONLY Drizzle queries over the surviving
 * mining tables and registers the tools on the orchestrator's
 * `BrainToolRegistry` (the same registry seam the persona-kernel bridge uses)
 * so the main loop discovers (toolSearch) and dispatches (9-hook chain) them
 * MID-TURN.
 *
 * EVIDENCE CONTRACT
 * -----------------
 * Each kernel tool emits a `forecast:world.*:<sha>` Citation. The adapted
 * executor surfaces those citations on the returned output object under the
 * `citations` key — exactly the shape the main loop's CitationAccumulator
 * `harvestFromOutput` harvests — so every forward-simulation the brain runs
 * lands in the answer's evidence chain (auditable deliberation).
 *
 * HARD RAILS
 * ----------
 *   - READ-ONLY. Every query is a SELECT. This module NEVER writes, never
 *     imports LedgerService, never touches a ledger table. Only
 *     `LedgerService.post()` moves money (CLAUDE.md hard rule); the
 *     simulator only ever *reads* historical operational state.
 *   - TENANT-SCOPED. Every query carries an explicit `tenant_id` predicate
 *     closed over from the cached brain's scope (the composition root caches
 *     one brain per (tenant, user, role)). A tenant-scoped brain asked to
 *     simulate another tenant's estate gets an empty history (the kernel tool
 *     then surfaces its honest `no history` error to the model) — never a
 *     cross-tenant read. Platform-tier brains may read the requested tenant.
 *   - HONEST-DEGRADE. A missing table / column / row / non-uuid id degrades
 *     to an empty history series and NEVER throws a raw DB error into the
 *     agent loop. The kernel tool converts empty history into a structured
 *     `{ kind: 'error' }` the model can self-correct on.
 *
 * STATE-VECTOR MAPPING (property-era field names are a kept-verbatim
 * contract; the mining semantics live here):
 *   PropertyState.vacancyRate        → site idle-day fraction (days in the
 *                                      bucket with zero production records)
 *   PropertyState.avgRentMajor       → mean realised sale value (net) per
 *                                      bucket, carried forward when quiet
 *   PropertyState.arrearsRate        → unpaid fraction of the site's sales
 *                                      as of the bucket end
 *   PropertyState.maintenanceBacklog → open mining_tasks as of bucket end
 *   PropertyState.conditionScore     → 1 / (1 + open incidents) as of end
 *   TenantState (counterparty)       → buyer/offtake-agreement payment
 *                                      behaviour from `sales`
 *   AgencyState                      → estate-wide roll-up (agreements,
 *                                      tasks, AI cost, headcount, automation)
 */

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  tools as kernelTools,
  type BrainToolRegistry,
  type BrainToolSpec,
  type ScopeContext,
  type Tool,
  type ToolOutcome,
  type worldModel,
} from '@borjie/central-intelligence';

type PropertyState = worldModel.PropertyState;
type TenantState = worldModel.TenantState;
type AgencyState = worldModel.AgencyState;
type WorldModelToolDeps = Parameters<
  typeof kernelTools.createWorldModelKernelTools
>[0];

/** Narrow structural db seam — only `execute(sql)` is needed (test-double-able). */
export interface WorldModelDbExecLike {
  execute(query: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Window + bucket constants
// ---------------------------------------------------------------------------

/** Trailing observation window for site + estate series. ~6 months. */
export const WORLD_MODEL_WINDOW_DAYS = 180;
/** Trailing observation window for counterparty payment behaviour. ~1 year. */
export const COUNTERPARTY_WINDOW_DAYS = 360;
/** Observations per series — enough for a non-degenerate linear fit. */
export const WORLD_MODEL_BUCKETS = 6;

const DAY_MS = 86_400_000;

// Column-intrinsic currency units. These name the unit of a SPECIFIC column
// (`sales.net_tzs` is definitionally TZS-denominated; `ai_cost_entries.
// cost_usd_micro` definitionally USD) — they are data labels, NOT display
// defaults; rendering still goes through formatCurrency at the surface.
const SALES_NET_CURRENCY = 'TZS';
const AI_COST_CURRENCY = 'USD';

// ---------------------------------------------------------------------------
// Row coercion helpers (mirrors estate-baseline-computer.ts idioms)
// ---------------------------------------------------------------------------

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(rows) ? rows : [];
}

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

/** Parse a pg timestamp/date cell to epoch-ms, or null. */
function msOf(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function strOf(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Several mining tables (`mining_tasks`) type their id/FK columns as `uuid`.
 * Guard before casting a bound param so a non-uuid id degrades to a skipped
 * read instead of a raw Postgres cast error (same idiom as
 * agency-port-bindings.ts).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Evenly-spaced bucket-end timestamps (epoch ms), oldest-first, ending at
 * `now`. For 6 buckets over 180d: [now-150d, now-120d, ..., now].
 */
export function bucketEnds(
  nowMs: number,
  windowDays: number,
  buckets: number,
): ReadonlyArray<number> {
  const n = Math.max(2, buckets);
  const stepMs = (windowDays / n) * DAY_MS;
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(nowMs - i * stepMs);
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// Shared row shapes the bucket composers fold over
// ---------------------------------------------------------------------------

interface SaleObs {
  /** Sale timestamp (epoch ms). */
  readonly tsMs: number;
  /** Net realised value in major units (column unit: TZS). */
  readonly netMajor: number | null;
  /** When payment landed (epoch ms); null = still unpaid. */
  readonly paidAtMs: number | null;
}

interface SpanObs {
  /** Row creation (epoch ms). */
  readonly startMs: number;
  /** Row resolution (completed/closed/deleted/left, epoch ms); null = open. */
  readonly endMs: number | null;
}

function saleObsOf(row: Record<string, unknown>): SaleObs | null {
  const tsMs = msOf(row.ts);
  if (tsMs === null) return null;
  const receivedMs = msOf(row.payment_received_at);
  const status = strOf(row.payment_status);
  // A row marked paid without a dated receipt is treated as paid at sale
  // time — it is never in arrears, which is the conservative read.
  const paidAtMs =
    receivedMs ?? (status === 'paid' ? tsMs : null);
  return {
    tsMs,
    netMajor: numOf(row.net_tzs) ?? numOf(row.gross_price_tzs),
    paidAtMs,
  };
}

function isOpenAt(span: SpanObs, atMs: number): boolean {
  return span.startMs <= atMs && (span.endMs === null || span.endMs > atMs);
}

// ---------------------------------------------------------------------------
// Fetcher factory — binds the three WorldModelToolDeps fetchers to READ-ONLY
// Drizzle queries, closed over the cached brain's scope tenant.
// ---------------------------------------------------------------------------

export interface BuildWorldModelFetchersArgs {
  readonly db: WorldModelDbExecLike;
  /**
   * The cached brain's tenant. `null` = platform-tier brain (may read the
   * tenant the tool input names); non-null = HARD scope (mismatching reads
   * degrade to empty history, never cross-tenant).
   */
  readonly scopeTenantId: string | null;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

export function buildWorldModelFetchers(
  args: BuildWorldModelFetchersArgs,
): WorldModelToolDeps {
  const { db, scopeTenantId } = args;
  const now = args.now ?? Date.now;

  // ── Site trajectory history ────────────────────────────────────────────
  async function fetchPropertyHistory(
    propertyId: string,
  ): Promise<ReadonlyArray<PropertyState>> {
    try {
      // Resolve the site + its owning tenant; enforce the scope rail.
      const siteRes = await db.execute(sql`
        SELECT id, tenant_id
          FROM sites
         WHERE id = ${propertyId}
         LIMIT 1
      `);
      const site = rowsOf(siteRes)[0];
      const siteTenantId = site ? strOf(site.tenant_id) : null;
      if (!siteTenantId) return Object.freeze([]);
      if (scopeTenantId !== null && siteTenantId !== scopeTenantId) {
        return Object.freeze([]);
      }

      const nowMs = now();
      const cutoff = new Date(nowMs - WORLD_MODEL_WINDOW_DAYS * DAY_MS);

      // Realised sales for the site (via its ore parcels).
      const salesRes = await db.execute(sql`
        SELECT s.ts, s.net_tzs, s.gross_price_tzs, s.payment_status,
               s.payment_received_at
          FROM sales s
          JOIN ore_parcels p ON p.id = s.parcel_id
         WHERE s.tenant_id = ${siteTenantId}
           AND p.site_id = ${propertyId}
           AND s.ts >= ${cutoff}
      `);
      const sales = rowsOf(salesRes)
        .map(saleObsOf)
        .filter((s): s is SaleObs => s !== null);

      // Active production days (any production record that day = active).
      const prodRes = await db.execute(sql`
        SELECT DISTINCT date_trunc('day', ts) AS day
          FROM production_records
         WHERE tenant_id = ${siteTenantId}
           AND site_id = ${propertyId}
           AND ts >= ${cutoff}
      `);
      const activeDayMs = rowsOf(prodRes)
        .map((r) => msOf(r.day))
        .filter((d): d is number => d !== null);

      // Open-task backlog spans. `mining_tasks` keys are uuid-typed —
      // guard before casting (non-uuid ids degrade to zero backlog).
      let taskSpans: ReadonlyArray<SpanObs> = [];
      if (isUuid(propertyId) && isUuid(siteTenantId)) {
        const taskRes = await db.execute(sql`
          SELECT created_at, completed_at, status
            FROM mining_tasks
           WHERE tenant_id = ${siteTenantId}::uuid
             AND site_id = ${propertyId}::uuid
             AND (completed_at IS NULL OR completed_at >= ${cutoff})
             AND status NOT IN ('cancelled')
        `);
        taskSpans = rowsOf(taskRes)
          .map((r): SpanObs | null => {
            const startMs = msOf(r.created_at);
            if (startMs === null) return null;
            return { startMs, endMs: msOf(r.completed_at) };
          })
          .filter((s): s is SpanObs => s !== null);
      }

      // Open-incident spans → condition roll-up.
      const incidentRes = await db.execute(sql`
        SELECT occurred_at, closed_at
          FROM incidents
         WHERE tenant_id = ${siteTenantId}
           AND site_id = ${propertyId}
           AND (closed_at IS NULL OR closed_at >= ${cutoff})
      `);
      const incidentSpans = rowsOf(incidentRes)
        .map((r): SpanObs | null => {
          const startMs = msOf(r.occurred_at);
          if (startMs === null) return null;
          return { startMs, endMs: msOf(r.closed_at) };
        })
        .filter((s): s is SpanObs => s !== null);

      // No signal at all → honest "no history" (never a fabricated flat line).
      if (
        sales.length === 0 &&
        activeDayMs.length === 0 &&
        taskSpans.length === 0 &&
        incidentSpans.length === 0
      ) {
        return Object.freeze([]);
      }

      return composeSiteSeries({
        siteId: propertyId,
        tenantId: siteTenantId,
        nowMs,
        sales,
        activeDayMs,
        taskSpans,
        incidentSpans,
      });
    } catch {
      // Honest-degrade: the kernel tool maps empty history to a structured
      // retryable-false error the model can self-correct on.
      return Object.freeze([]);
    }
  }

  // ── Counterparty (offtake-agreement / buyer) arrears history ──────────
  async function fetchTenantHistory(
    leaseId: string,
  ): Promise<ReadonlyArray<TenantState>> {
    try {
      // Resolve the agreement → buyer; fall back to treating the id as a
      // buyer id directly (generative — the model may pass either).
      const agreementRes = await db.execute(sql`
        SELECT id, buyer_id, tenant_id, created_at, signed_at
          FROM offtake_agreements
         WHERE id = ${leaseId}
           AND deleted_at IS NULL
         LIMIT 1
      `);
      const agreement = rowsOf(agreementRes)[0];

      let buyerId: string | null = agreement
        ? strOf(agreement.buyer_id)
        : null;
      let counterpartyTenantId: string | null = agreement
        ? strOf(agreement.tenant_id)
        : null;
      let tenureStartMs: number | null = agreement
        ? (msOf(agreement.signed_at) ?? msOf(agreement.created_at))
        : null;

      if (!buyerId) {
        const buyerRes = await db.execute(sql`
          SELECT id, tenant_id, created_at
            FROM buyers
           WHERE id = ${leaseId}
           LIMIT 1
        `);
        const buyer = rowsOf(buyerRes)[0];
        if (buyer) {
          buyerId = strOf(buyer.id);
          counterpartyTenantId = strOf(buyer.tenant_id);
          tenureStartMs = msOf(buyer.created_at);
        }
      }

      if (!buyerId || !counterpartyTenantId) return Object.freeze([]);
      if (scopeTenantId !== null && counterpartyTenantId !== scopeTenantId) {
        return Object.freeze([]);
      }

      const nowMs = now();
      const cutoff = new Date(nowMs - COUNTERPARTY_WINDOW_DAYS * DAY_MS);
      const salesRes = await db.execute(sql`
        SELECT ts, net_tzs, gross_price_tzs, payment_status,
               payment_received_at
          FROM sales
         WHERE tenant_id = ${counterpartyTenantId}
           AND buyer_id = ${buyerId}
           AND ts >= ${cutoff}
      `);
      const sales = rowsOf(salesRes)
        .map(saleObsOf)
        .filter((s): s is SaleObs => s !== null);
      if (sales.length === 0) return Object.freeze([]);

      return composeCounterpartySeries({
        leaseId,
        tenantId: counterpartyTenantId,
        nowMs,
        tenureStartMs,
        sales,
      });
    } catch {
      return Object.freeze([]);
    }
  }

  // ── Estate-wide regime history ─────────────────────────────────────────
  async function fetchAgencyHistory(
    tenantId: string,
  ): Promise<ReadonlyArray<AgencyState>> {
    try {
      // Scope rail: a tenant-bound brain may only simulate ITS estate.
      const effectiveTenantId =
        scopeTenantId !== null ? scopeTenantId : tenantId;
      if (scopeTenantId !== null && tenantId !== scopeTenantId) {
        return Object.freeze([]);
      }

      const nowMs = now();
      const cutoff = new Date(nowMs - WORLD_MODEL_WINDOW_DAYS * DAY_MS);

      // Active offtake agreements (spans; rows resolved before the window
      // can never be active in any bucket, so the cutoff bound is exact).
      const agreementsRes = await db.execute(sql`
        SELECT created_at, deleted_at, status
          FROM offtake_agreements
         WHERE tenant_id = ${effectiveTenantId}
           AND (deleted_at IS NULL OR deleted_at >= ${cutoff})
      `);
      const agreementSpans = rowsOf(agreementsRes)
        .map((r): SpanObs | null => {
          const startMs = msOf(r.created_at);
          if (startMs === null) return null;
          const status = strOf(r.status);
          // A cancelled/terminated agreement with no deleted_at still ends;
          // without a terminal timestamp we conservatively treat it as
          // never-active rather than forever-active.
          if (
            (status === 'cancelled' || status === 'terminated') &&
            msOf(r.deleted_at) === null
          ) {
            return null;
          }
          return { startMs, endMs: msOf(r.deleted_at) };
        })
        .filter((s): s is SpanObs => s !== null);

      // Open work (mining_tasks; uuid-typed tenant key) + automation signal
      // (provenance.via = 'agent_apply'|'chat' rows were AI-landed writes).
      let taskSpans: ReadonlyArray<SpanObs> = [];
      let aiTaskCreatedMs: ReadonlyArray<number> = [];
      let allTaskCreatedMs: ReadonlyArray<number> = [];
      if (isUuid(effectiveTenantId)) {
        const tasksRes = await db.execute(sql`
          SELECT created_at, completed_at, status,
                 provenance->>'via' AS via
            FROM mining_tasks
           WHERE tenant_id = ${effectiveTenantId}::uuid
             AND (completed_at IS NULL OR completed_at >= ${cutoff})
             AND status NOT IN ('cancelled')
        `);
        const rows = rowsOf(tasksRes);
        taskSpans = rows
          .map((r): SpanObs | null => {
            const startMs = msOf(r.created_at);
            if (startMs === null) return null;
            return { startMs, endMs: msOf(r.completed_at) };
          })
          .filter((s): s is SpanObs => s !== null);
        const created = rows
          .map((r) => ({ ms: msOf(r.created_at), via: strOf(r.via) }))
          .filter((r): r is { ms: number; via: string | null } => r.ms !== null);
        allTaskCreatedMs = created.map((r) => r.ms);
        aiTaskCreatedMs = created
          .filter((r) => r.via === 'agent_apply' || r.via === 'chat')
          .map((r) => r.ms);
      }

      // AI spend (column unit: USD micro).
      const costRes = await db.execute(sql`
        SELECT occurred_at, cost_usd_micro
          FROM ai_cost_entries
         WHERE tenant_id = ${effectiveTenantId}
           AND occurred_at >= ${cutoff}
      `);
      const costObs = rowsOf(costRes)
        .map((r) => ({ ms: msOf(r.occurred_at), micro: numOf(r.cost_usd_micro) }))
        .filter(
          (r): r is { ms: number; micro: number } =>
            r.ms !== null && r.micro !== null,
        );

      // Headcount (org memberships bound to this platform tenant).
      const staffRes = await db.execute(sql`
        SELECT joined_at, left_at, status
          FROM org_memberships
         WHERE platform_tenant_id = ${effectiveTenantId}
           AND (left_at IS NULL OR left_at >= ${cutoff})
      `);
      const staffSpans = rowsOf(staffRes)
        .map((r): SpanObs | null => {
          const startMs = msOf(r.joined_at);
          if (startMs === null) return null;
          const status = strOf(r.status);
          if (status === 'BLOCKED' && msOf(r.left_at) === null) return null;
          return { startMs, endMs: msOf(r.left_at) };
        })
        .filter((s): s is SpanObs => s !== null);

      if (
        agreementSpans.length === 0 &&
        taskSpans.length === 0 &&
        costObs.length === 0 &&
        staffSpans.length === 0
      ) {
        return Object.freeze([]);
      }

      return composeEstateSeries({
        tenantId: effectiveTenantId,
        nowMs,
        agreementSpans,
        taskSpans,
        allTaskCreatedMs,
        aiTaskCreatedMs,
        costObs,
        staffSpans,
      });
    } catch {
      return Object.freeze([]);
    }
  }

  return Object.freeze({
    fetchPropertyHistory,
    fetchTenantHistory,
    fetchAgencyHistory,
  });
}

// ---------------------------------------------------------------------------
// Pure bucket composers — fold raw observations into oldest-first state-
// vector series. No IO; deterministic; immutable.
// ---------------------------------------------------------------------------

function composeSiteSeries(args: {
  readonly siteId: string;
  readonly tenantId: string;
  readonly nowMs: number;
  readonly sales: ReadonlyArray<SaleObs>;
  readonly activeDayMs: ReadonlyArray<number>;
  readonly taskSpans: ReadonlyArray<SpanObs>;
  readonly incidentSpans: ReadonlyArray<SpanObs>;
}): ReadonlyArray<PropertyState> {
  const ends = bucketEnds(args.nowMs, WORLD_MODEL_WINDOW_DAYS, WORLD_MODEL_BUCKETS);
  const bucketMs = (WORLD_MODEL_WINDOW_DAYS / WORLD_MODEL_BUCKETS) * DAY_MS;
  const bucketDays = bucketMs / DAY_MS;
  let lastKnownAvgSale = 0;

  const series = ends.map((endMs): PropertyState => {
    const startMs = endMs - bucketMs;

    const activeDays = args.activeDayMs.filter(
      (d) => d > startMs && d <= endMs,
    ).length;
    const idleFraction = clamp01(1 - activeDays / bucketDays);

    const bucketSales = args.sales.filter((s) => s.tsMs > startMs && s.tsMs <= endMs);
    const valued = bucketSales
      .map((s) => s.netMajor)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    if (valued.length > 0) {
      lastKnownAvgSale =
        valued.reduce((a, b) => a + b, 0) / valued.length;
    }

    // Arrears as-of bucket end over ALL window sales due by then.
    const due = args.sales.filter((s) => s.tsMs <= endMs);
    const unpaid = due.filter(
      (s) => s.paidAtMs === null || s.paidAtMs > endMs,
    );
    const arrearsRate = due.length === 0 ? 0 : clamp01(unpaid.length / due.length);

    const backlog = args.taskSpans.filter((t) => isOpenAt(t, endMs)).length;
    const openIncidents = args.incidentSpans.filter((i) =>
      isOpenAt(i, endMs),
    ).length;

    return Object.freeze({
      propertyId: args.siteId,
      tenantId: args.tenantId,
      observedAt: new Date(endMs).toISOString(),
      vacancyRate: idleFraction,
      avgRentMajor: lastKnownAvgSale,
      currency: SALES_NET_CURRENCY,
      arrearsRate,
      maintenanceBacklog: backlog,
      // No honest mining series exists for lease renewal/turnover today —
      // constants carry zero slope so they cannot distort the regime fit.
      renewalRate: 0,
      turnoverRate: 0,
      conditionScore: clamp01(1 / (1 + openIncidents)),
    });
  });
  return Object.freeze(series);
}

function composeCounterpartySeries(args: {
  readonly leaseId: string;
  readonly tenantId: string;
  readonly nowMs: number;
  readonly tenureStartMs: number | null;
  readonly sales: ReadonlyArray<SaleObs>;
}): ReadonlyArray<TenantState> {
  const ends = bucketEnds(
    args.nowMs,
    COUNTERPARTY_WINDOW_DAYS,
    WORLD_MODEL_BUCKETS,
  );
  const firstSaleMs = Math.min(...args.sales.map((s) => s.tsMs));
  const tenureStartMs = args.tenureStartMs ?? firstSaleMs;

  const series = ends
    // A bucket that predates the relationship is not an observation.
    .filter((endMs) => endMs >= Math.min(tenureStartMs, firstSaleMs))
    .map((endMs): TenantState => {
      const due = args.sales.filter((s) => s.tsMs <= endMs);
      const unpaid = due.filter(
        (s) => s.paidAtMs === null || s.paidAtMs > endMs,
      );
      const arrearsAmountMajor = unpaid.reduce(
        (sum, s) => sum + (s.netMajor ?? 0),
        0,
      );
      const oldestUnpaidMs =
        unpaid.length > 0 ? Math.min(...unpaid.map((s) => s.tsMs)) : null;
      const arrearsDays =
        oldestUnpaidMs === null
          ? 0
          : Math.max(0, Math.round((endMs - oldestUnpaidMs) / DAY_MS));

      // On-time fraction of the last (≤12) sales due by this bucket:
      // paid within 30 days of the sale.
      const recent = [...due].sort((a, b) => b.tsMs - a.tsMs).slice(0, 12);
      const onTime = recent.filter(
        (s) =>
          s.paidAtMs !== null &&
          s.paidAtMs <= endMs &&
          s.paidAtMs - s.tsMs <= 30 * DAY_MS,
      ).length;
      const paymentRegularity =
        recent.length === 0 ? 0 : clamp01(onTime / recent.length);

      const tenureMonths = Math.max(
        0,
        Math.floor((endMs - tenureStartMs) / (30 * DAY_MS)),
      );

      return Object.freeze({
        leaseId: args.leaseId,
        tenantId: args.tenantId,
        observedAt: new Date(endMs).toISOString(),
        arrearsDays,
        arrearsAmountMajor,
        currency: SALES_NET_CURRENCY,
        paymentRegularity,
        tenureMonths,
        // No structured dispute / complaint series exists in the mining
        // schema today — constant zero carries no slope.
        disputeCount: 0,
        maintenanceComplaintsLast90d: 0,
      });
    });
  return Object.freeze(series);
}

function composeEstateSeries(args: {
  readonly tenantId: string;
  readonly nowMs: number;
  readonly agreementSpans: ReadonlyArray<SpanObs>;
  readonly taskSpans: ReadonlyArray<SpanObs>;
  readonly allTaskCreatedMs: ReadonlyArray<number>;
  readonly aiTaskCreatedMs: ReadonlyArray<number>;
  readonly costObs: ReadonlyArray<{ readonly ms: number; readonly micro: number }>;
  readonly staffSpans: ReadonlyArray<SpanObs>;
}): ReadonlyArray<AgencyState> {
  const ends = bucketEnds(args.nowMs, WORLD_MODEL_WINDOW_DAYS, WORLD_MODEL_BUCKETS);
  const THIRTY_D_MS = 30 * DAY_MS;

  const series = ends.map((endMs): AgencyState => {
    const activeLeases = args.agreementSpans.filter((a) =>
      isOpenAt(a, endMs),
    ).length;
    const activeWorkOrders = args.taskSpans.filter((t) =>
      isOpenAt(t, endMs),
    ).length;
    const aiCostMicro = args.costObs
      .filter((c) => c.ms > endMs - THIRTY_D_MS && c.ms <= endMs)
      .reduce((sum, c) => sum + c.micro, 0);
    const stafCount = args.staffSpans.filter((s) => isOpenAt(s, endMs)).length;
    const createdRecently = args.allTaskCreatedMs.filter(
      (ms) => ms > endMs - THIRTY_D_MS && ms <= endMs,
    ).length;
    const aiCreatedRecently = args.aiTaskCreatedMs.filter(
      (ms) => ms > endMs - THIRTY_D_MS && ms <= endMs,
    ).length;
    const automationFraction =
      createdRecently === 0 ? 0 : clamp01(aiCreatedRecently / createdRecently);

    return Object.freeze({
      tenantId: args.tenantId,
      observedAt: new Date(endMs).toISOString(),
      activeLeases,
      activeWorkOrders,
      aiCostMajorLast30d: aiCostMicro / 1_000_000,
      currency: AI_COST_CURRENCY,
      stafCount,
      automationFraction,
    });
  });
  return Object.freeze(series);
}

// ---------------------------------------------------------------------------
// Kernel-Tool → BrainToolSpec bridge (same seam the persona bridge uses).
// ---------------------------------------------------------------------------

/** Zod twins of the kernel tools' JSON-Schema inputs (the registry layer
 *  validates with these BEFORE the executor runs; the kernel tool re-guards
 *  internally). */
const PropertyTrajectoryInputSchema = z
  .object({
    propertyId: z.string().min(1),
    horizonDays: z.number().int().min(1).max(1825).optional(),
    samplePoints: z.number().int().min(2).max(30).optional(),
  })
  .strict();

const ArrearsTrajectoryInputSchema = z
  .object({
    leaseId: z.string().min(1),
    horizonDays: z.number().int().min(1).max(1825).optional(),
    samplePoints: z.number().int().min(2).max(30).optional(),
  })
  .strict();

const MarketRegimeInputSchema = z
  .object({
    tenantId: z.string().min(1),
  })
  .strict();

export interface WorldModelBridgeScope {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly role?: string;
}

/** Build the per-brain ScopeContext the kernel tools' invoke() guards on. */
function buildWorldModelScopeContext(
  scope: WorldModelBridgeScope,
): ScopeContext {
  const actorUserId = scope.userId ?? 'sovereign-orchestrator';
  const roles = scope.role ? Object.freeze([scope.role]) : Object.freeze([]);
  if (scope.tenantId !== null) {
    return Object.freeze({
      kind: 'tenant' as const,
      tenantId: scope.tenantId,
      actorUserId,
      roles,
      personaId: 'mr-mwikila-head',
    });
  }
  return Object.freeze({
    kind: 'platform' as const,
    actorUserId,
    roles,
    personaId: 'mr-mwikila-head',
  });
}

/**
 * Adapt a kernel agent-loop `Tool` to a kernel `BrainToolSpec` whose executor
 * closes over the per-brain ScopeContext. An `{ kind: 'error' }` outcome is
 * surfaced as an executor throw — the dispatcher maps it to `tool_error` so
 * the main loop re-plans instead of treating the failure as a result. An ok
 * outcome carries the tool's `forecast:*` Citations under the `citations` key
 * the main loop's CitationAccumulator harvests (forecasts-as-evidence).
 *
 * The registry layer parses every call against `schemaIn` BEFORE the executor
 * runs (and the kernel tool re-guards internally), so the `input as I` cast
 * is validated twice at runtime.
 */
export function worldModelToolToBrainToolSpec<I, O>(
  tool: Tool<I, O>,
  ctx: ScopeContext,
  schemaIn: z.ZodType<unknown>,
): BrainToolSpec<unknown, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    schemaIn,
    schemaOut: z.unknown(),
    // Deterministic local compute over already-fetched rows — no LLM spend.
    tier: 'free',
    // READ-ONLY simulation; the 9-hook chain still audits every dispatch.
    requiresApproval: false,
    async executor(input: unknown): Promise<unknown> {
      const outcome: ToolOutcome<O> = await tool.invoke({
        toolName: tool.name,
        input: input as I,
        ctx,
      });
      if (outcome.kind !== 'ok') {
        throw new Error(outcome.message);
      }
      const out: unknown = outcome.output;
      const base =
        out !== null && typeof out === 'object'
          ? { ...(out as Record<string, unknown>) }
          : { value: out ?? null };
      return Object.freeze({ ...base, citations: outcome.citations });
    },
  };
}

// ---------------------------------------------------------------------------
// Registration — the single entry point sovereign.ts calls.
// ---------------------------------------------------------------------------

export interface RegisterWorldModelToolsArgs {
  readonly registry: BrainToolRegistry;
  readonly db: WorldModelDbExecLike;
  readonly scope: WorldModelBridgeScope;
  readonly logger?: {
    warn(meta: Record<string, unknown>, msg: string): void;
  };
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
}

/**
 * Build the world-model kernel-tool bundle over READ-ONLY Drizzle fetchers
 * and register all three tools on the orchestrator's BrainToolRegistry.
 * Registration is defensive per-tool (a name collision is logged + skipped).
 * Returns the count of successfully registered tools.
 */
export function registerWorldModelToolsOnRegistry(
  args: RegisterWorldModelToolsArgs,
): number {
  const fetchers = buildWorldModelFetchers({
    db: args.db,
    scopeTenantId: args.scope.tenantId,
    ...(args.now ? { now: args.now } : {}),
  });
  const bundle = kernelTools.createWorldModelKernelTools(fetchers);
  const ctx = buildWorldModelScopeContext(args.scope);

  const specs: ReadonlyArray<BrainToolSpec<unknown, unknown>> = [
    worldModelToolToBrainToolSpec(
      bundle.propertyTrajectory,
      ctx,
      PropertyTrajectoryInputSchema,
    ),
    worldModelToolToBrainToolSpec(
      bundle.arrearsTrajectory,
      ctx,
      ArrearsTrajectoryInputSchema,
    ),
    worldModelToolToBrainToolSpec(bundle.marketRegime, ctx, MarketRegimeInputSchema),
  ];

  let registered = 0;
  for (const spec of specs) {
    try {
      args.registry.register(spec);
      registered += 1;
    } catch (err) {
      args.logger?.warn(
        {
          tool: spec.name,
          reason: err instanceof Error ? err.message : String(err),
        },
        'world-model-wiring: failed to register world-model tool onto kernel registry (skipped)',
      );
    }
  }
  return registered;
}
