/**
 * /api/v1/owner/brief — one-round-trip owner home composition.
 *
 * Per Docs/research/owner-status-sota.md: the owner home opens with a
 * single request that resolves the seven slots used by the owner-web
 * cockpit (daily-brief, decisions queue, cash-runway,
 * production-vs-target, 27-mar cliff status, open high-severity
 * incidents, licence health). Pre-computed by the 06:00 EAT cron
 * (`services/consolidation-worker/src/tasks/owner-brief-cron.ts`) and
 * cached in `owner_brief_snapshots`. The BFF returns the cached row
 * when present, otherwise composes on-demand and persists with
 * `source='on-demand'` so the next hit is warm.
 *
 * Routes:
 *   GET /  — return today's brief for the authenticated tenant.
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS.
 *
 * Service-layer functions (composeOwnerBrief + slot computers) are
 * exported separately so the cron task and the unit tests share a
 * single composition path. No HTTP self-call.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  licences,
  shiftReports,
  sales,
  incidents,
  ownerBriefSnapshots,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
// IP-EGRESS (CLOSE-G) — the advisor slice is model-authored prose (the
// `insight` + `action` lines come from `callBrainOnce`). It MUST pass the
// FAIL-CLOSED egress firewall before it is returned to the owner cockpit so no
// persona / model / provider identity, rationale or canary leaks. DEFAULT-ON;
// kill-switch `BORJIE_EGRESS_FILTER`. See `composition/egress-filter-wiring.ts`.
import { getEgressFilter } from '../../composition/egress-filter-wiring.js';

const moduleLogger = createLogger('owner-brief');

/** Generic egress fail-closed placeholder for model-authored advisor text. */
const ADVISOR_EGRESS_FAIL_CLOSED = '[redacted]';

/**
 * IP-EGRESS (CLOSE-G) — guard one model-authored advisor leaf through the
 * FAIL-CLOSED egress firewall before it reaches the owner cockpit. A thrown
 * filter (or construction fault) yields a generic placeholder, never the raw
 * text. Empty / non-string spans pass through unchanged.
 */
function guardAdvisorText(text: string, tenantId: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    return getEgressFilter().guardFinal(text, tenantId).text;
  } catch (err) {
    moduleLogger.error('advisor egress guard threw — failing closed', {
      tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return ADVISOR_EGRESS_FAIL_CLOSED;
  }
}

// ----------------------------------------------------------------------------
// OwnerBrief zod schema — pins the cached jsonb shape end-to-end.
// ----------------------------------------------------------------------------

const DailyBriefSlotSchema = z.object({
  date: z.string(),
  shiftsToday: z.number().int().nonnegative(),
  openIncidents: z.number().int().nonnegative(),
  openGrievances: z.number().int().nonnegative(),
  criticalIncidents: z.number().int().nonnegative(),
});

const DecisionsSlotSchema = z.object({
  pendingCount: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      summary: z.string(),
      severity: z.string().nullable(),
    }),
  ),
});

const CashRunwaySlotSchema = z.object({
  // Sales INFLOW signal over the trailing 90 days — retained as a
  // secondary "90-day net · N sales sampled" display. This is NOT a runway
  // input (a 90-day inflow total divided by its own 90-day daily average is
  // always 90 — the degenerate constant this slot used to ship as "runway").
  ninetyDayNetTzs: z.number(),
  dailyAvgTzs: z.number(),
  sampleCount: z.number().int().nonnegative(),
  // REAL runway inputs — mirror the risk-scanner cash-flow resolver
  // (services/api-gateway/src/services/risk-scanner/scanner.ts:resolveCashFlow).
  //   cash on hand = Σ latest `cash_balances.balance_tzs` per account
  //   net daily burn = Σ actual `costs.amount_tzs` over 30d / 30
  //   runway (days) = floor(cash_on_hand / net_daily_burn)
  // Each is nullable so an ABSENT treasury/cost feed surfaces as an honest
  // unknown (`null`) rather than a fabricated number. `runwayDays === null`
  // means either (a) inputs missing → unknown, or (b) burn ≤ 0 → the estate
  // is net cash-positive / not burning (no finite runway); `burnStatus`
  // distinguishes the two so the FE renders the correct honest copy.
  //
  // `.default(...)` on each new field lets a snapshot PERSISTED BEFORE the
  // real-runway fields shipped still parse (readTodaysSnapshot) — it simply
  // reads back as an honest `unknown` runway until the next compose/cron
  // re-authors it. Without the defaults every legacy cached row would fail
  // schema validation and force an on-demand recompose on first read.
  cashOnHandTzs: z.number().nullable().default(null),
  netDailyBurnTzs: z.number().nullable().default(null),
  runwayDays: z.number().int().nonnegative().nullable().default(null),
  burnStatus: z.enum(['burning', 'no_burn', 'unknown']).default('unknown'),
});

const ProductionSlotSchema = z.object({
  window: z.literal('30d'),
  perSite: z.array(
    z.object({
      siteId: z.string().nullable(),
      tonnes: z.number(),
      fuel: z.number(),
      shifts: z.number().int().nonnegative(),
    }),
  ),
});

const CliffStatusSlotSchema = z.object({
  cliffDateIso: z.string(),
  postCliffSales: z.number().int().nonnegative(),
  usdDenominated: z.number().int().nonnegative(),
  remediationComplete: z.boolean(),
});

const OpenHighIncidentsSlotSchema = z.object({
  count: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.string(),
      severity: z.string(),
      kind: z.string(),
      occurredAt: z.string().nullable(),
    }),
  ),
});

const LicenceHealthSlotSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  atRiskCount: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.string(),
      number: z.string().nullable(),
      kind: z.string().nullable(),
      daysToExpiry: z.number().int().nullable(),
      atRisk: z.boolean(),
    }),
  ),
});

// Advisor slice — Wave OWNER-OS. Live-brain strategic insight (≤2
// sentences) + a single concrete next action that the FE renders as a
// sticky "Today's advisor note" chip above the home-chat composer.
// nullable so the surrounding brief still loads when the brain is down.
const AdvisorSlotSchema = z.object({
  insight: z.string(),
  action: z.string(),
  generatedAtIso: z.string(),
  provider: z.string(),
  latencyMs: z.number().int().nonnegative(),
  /**
   * ZERO-MIX (language-engineering canon): the locale the model was PINNED
   * to author `insight` + `action` in. The wire stays honest — the FE
   * attributes the prose with this `lang` so a Swahili-pinned advisor note
   * never renders as an un-attributed English block on a Swahili surface
   * (and vice-versa). Defaults to `en` for back-compat with snapshots
   * persisted before locale-pinning shipped.
   */
  lang: z.enum(['en', 'sw']).default('en'),
});

export const OwnerBriefSchema = z.object({
  schemaVersion: z.literal(1),
  composedAtIso: z.string(),
  dailyBrief: DailyBriefSlotSchema,
  decisions: DecisionsSlotSchema,
  cashRunway: CashRunwaySlotSchema,
  productionVsTarget: ProductionSlotSchema,
  cliffStatus: CliffStatusSlotSchema,
  openHighIncidents: OpenHighIncidentsSlotSchema,
  licenceHealth: LicenceHealthSlotSchema,
  /** Optional — null when the brain ladder failed during composition. */
  advisor: AdvisorSlotSchema.nullable().optional(),
});

export type OwnerBrief = z.infer<typeof OwnerBriefSchema>;

// ----------------------------------------------------------------------------
// Service-layer ports — kept narrow so the cron + tests share one path.
// ----------------------------------------------------------------------------

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
  select(...args: ReadonlyArray<unknown>): {
    from: (...a: ReadonlyArray<unknown>) => unknown;
  };
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Slot computers — each fetches a single owner-home slot from the DB.
// Designed for parallel fanout via Promise.all().
// ----------------------------------------------------------------------------

export async function getCockpitDailyBrief(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof DailyBriefSlotSchema>> {
  const today = dayKey(new Date());
  const [shifts, openIncidents, openGrievances] = await Promise.all([
    db
      .select()
      .from(shiftReports)
      .where(
        and(
          eq(shiftReports.tenantId, tenantId),
          eq(shiftReports.shiftDate, today),
        ),
      ),
    db
      .select()
      .from(incidents)
      .where(
        and(eq(incidents.tenantId, tenantId), eq(incidents.status, 'open')),
      )
      .limit(50),
    db.execute(
      sql`SELECT id FROM grievances WHERE tenant_id = ${tenantId} AND status = 'open' LIMIT 50`,
    ),
  ]);
  const incidentRows = (openIncidents ?? []) as ReadonlyArray<{
    severity?: string | null;
  }>;
  const grievanceRows = rowsOf(openGrievances);
  return {
    date: today,
    shiftsToday: (shifts ?? []).length,
    openIncidents: incidentRows.length,
    openGrievances: grievanceRows.length,
    criticalIncidents: incidentRows.filter(
      (i) => i.severity === 'critical' || i.severity === 'high',
    ).length,
  };
}

export async function getCockpitDecisions(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof DecisionsSlotSchema>> {
  // Decisions queue is union of: open high-severity incidents + licence
  // expiry risks. Bounded to 25 items so the home page stays under the
  // one-screen budget per owner-status-sota.md.
  //
  // ZERO-MIX / LOCALE-NEUTRAL WIRE (language-engineering canon): the row's
  // `incident.kind` is a STABLE machine enum (`safety`, `equipment`, …) — we
  // surface it as the `summary` so the FE (AlertQueuePanel) maps it to SOTA
  // per-locale copy at render. We DELIBERATELY do NOT select the free-form
  // `incidents.description` column: it is user-authored prose of UNKNOWN /
  // arbitrary language, and emitting it as `summary` rendered it RAW on a
  // localized panel (an EN/SW split-brain on every Swahili surface). The
  // wire carries only the code; only the render is localized.
  try {
    const result = await db.execute(
      sql`
        SELECT id::text,
               'incident' AS kind,
               COALESCE(kind, 'incident') AS summary,
               severity
          FROM incidents
         WHERE tenant_id = ${tenantId}
           AND status = 'open'
           AND severity IN ('critical', 'high')
         ORDER BY occurred_at DESC NULLS LAST
         LIMIT 25
      `,
    );
    const rows = rowsOf(result) as ReadonlyArray<{
      id?: unknown;
      kind?: unknown;
      summary?: unknown;
      severity?: unknown;
    }>;
    const items = rows.map((r) => ({
      id: String(r.id ?? ''),
      kind: String(r.kind ?? 'incident'),
      // `summary` is the locale-neutral incident-kind TOKEN, never prose.
      summary: String(r.summary ?? 'incident'),
      severity: r.severity == null ? null : String(r.severity),
    }));
    return { pendingCount: items.length, items };
  } catch (err) {
    moduleLogger.warn('decisions slot fetch failed', {
      tenantId,
      reason: messageOf(err),
    });
    return { pendingCount: 0, items: [] };
  }
}

/**
 * Pure cash-runway computation — a REAL days-of-cash projection, not the
 * degenerate `ninetyDayNet / (ninetyDayNet / 90) === 90` constant this slot
 * used to ship.
 *
 * Runway = cash_on_hand ÷ net_daily_burn (days the estate can operate at the
 * current burn before cash is exhausted). Honesty rules (D21 grounded-numbers):
 *   - inputs missing (no treasury balance and/or no cost feed) → `unknown`,
 *     `runwayDays: null`. Never a fabricated number.
 *   - burn ≤ 0 (the estate is net cash-positive / not spending) → `no_burn`,
 *     `runwayDays: null`. There is effectively no finite runway — represented
 *     as "no burn", NOT as 90 and NOT as ∞.
 *   - otherwise → `burning`, `runwayDays: floor(cash_on_hand / net_daily_burn)`.
 *
 * Mirrors services/api-gateway/src/services/risk-scanner/scanner.ts
 * (resolveCashFlow): floor(cashOnHand / dailyBurn) when dailyBurn > 0.
 */
export function computeCashRunway(inputs: {
  readonly cashOnHandTzs: number | null;
  readonly netDailyBurnTzs: number | null;
}): {
  readonly runwayDays: number | null;
  readonly burnStatus: 'burning' | 'no_burn' | 'unknown';
} {
  const { cashOnHandTzs, netDailyBurnTzs } = inputs;
  // No treasury balance OR no cost feed → we cannot ground a runway. Honest
  // unknown, never a constant.
  if (
    cashOnHandTzs === null ||
    netDailyBurnTzs === null ||
    !Number.isFinite(cashOnHandTzs) ||
    !Number.isFinite(netDailyBurnTzs)
  ) {
    return { runwayDays: null, burnStatus: 'unknown' };
  }
  // Burn ≤ 0 → the estate is not burning cash. No finite runway; surface as
  // "no burn" so the FE renders "—" / "no burn", never a fabricated 90 or ∞.
  if (netDailyBurnTzs <= 0) {
    return { runwayDays: null, burnStatus: 'no_burn' };
  }
  return {
    runwayDays: Math.max(0, Math.floor(cashOnHandTzs / netDailyBurnTzs)),
    burnStatus: 'burning',
  };
}

export async function getCockpitCashRunway(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof CashRunwaySlotSchema>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  // Secondary INFLOW signal — trailing-90-day net sales. Retained for the
  // "90-day net · N sales sampled" line; it is NOT a runway input.
  const recentSales = ((await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.ts, cutoff)))
    .orderBy(desc(sales.ts))) ?? []) as ReadonlyArray<{
    netTzs?: number | string | null;
  }>;
  const ninetyDayNetTzs = recentSales.reduce(
    (sum, s) => sum + Number(s.netTzs ?? 0),
    0,
  );
  const dailyAvgTzs = ninetyDayNetTzs / 90;

  // REAL runway inputs — cash on hand + net daily burn from the treasury +
  // cost ledgers. Same DISTINCT-ON-latest-per-account + 30-day-actual-cost
  // idiom the risk-scanner uses (scanner.ts:resolveCashFlow). A read failure
  // or empty feed yields `null` (honest unknown), never a fabricated figure.
  const { cashOnHandTzs, netDailyBurnTzs } = await readRunwayInputs(
    db,
    tenantId,
  );
  const { runwayDays, burnStatus } = computeCashRunway({
    cashOnHandTzs,
    netDailyBurnTzs,
  });

  return {
    ninetyDayNetTzs,
    dailyAvgTzs,
    sampleCount: recentSales.length,
    cashOnHandTzs,
    netDailyBurnTzs,
    runwayDays,
    burnStatus,
  };
}

/**
 * Read the two REAL runway inputs, each independently degradable to `null`:
 *   - cash on hand: Σ of the LATEST `cash_balances.balance_tzs` per account
 *     (DISTINCT ON (account_id) ... ORDER BY recorded_at DESC). A tenant with
 *     no treasury rows → `null` (no signal), never 0.
 *   - net daily burn: Σ actual `costs.amount_tzs` over the last 30 days / 30.
 *     A tenant with no cost rows → `null`, never 0 (a real "no burn" is only
 *     asserted when a cost feed exists but sums to ≤ 0 — the SQL returns 0 in
 *     that case, which `computeCashRunway` maps to `no_burn`).
 *
 * The two reads are independent (Promise.allSettled) so one failing feed does
 * not poison the other. Both fall back to `null` on any read error.
 */
async function readRunwayInputs(
  db: any,
  tenantId: string,
): Promise<{
  readonly cashOnHandTzs: number | null;
  readonly netDailyBurnTzs: number | null;
}> {
  const [cashResult, burnResult] = await Promise.allSettled([
    db.execute(sql`
      SELECT COALESCE(SUM(latest.balance_tzs), 0)::numeric AS cash_total,
             COUNT(*)::int AS account_count
        FROM (
          SELECT DISTINCT ON (account_id) balance_tzs
            FROM cash_balances
           WHERE tenant_id = ${tenantId}
           ORDER BY account_id, recorded_at DESC
        ) AS latest
    `),
    db.execute(sql`
      SELECT (COALESCE(SUM(amount_tzs), 0) / 30.0)::numeric AS daily_burn,
             COUNT(*)::int AS cost_rows
        FROM costs
       WHERE tenant_id = ${tenantId}
         AND state = 'actual'
         AND ts > NOW() - INTERVAL '30 days'
    `),
  ]);

  let cashOnHandTzs: number | null = null;
  if (cashResult.status === 'fulfilled') {
    const row = rowsOf(cashResult.value)[0] as
      | { cash_total?: unknown; account_count?: unknown }
      | undefined;
    // Only a REAL treasury feed grounds cash-on-hand: zero accounts → unknown.
    if (Number(row?.account_count ?? 0) > 0) {
      const parsed = Number(row?.cash_total ?? 0);
      cashOnHandTzs = Number.isFinite(parsed) ? parsed : null;
    }
  } else {
    moduleLogger.warn('cash-on-hand read failed — runway input unknown', {
      tenantId,
      reason: messageOf(cashResult.reason),
    });
  }

  let netDailyBurnTzs: number | null = null;
  if (burnResult.status === 'fulfilled') {
    const row = rowsOf(burnResult.value)[0] as
      | { daily_burn?: unknown; cost_rows?: unknown }
      | undefined;
    // Only a REAL cost feed grounds burn: zero cost rows → unknown (not 0).
    if (Number(row?.cost_rows ?? 0) > 0) {
      const parsed = Number(row?.daily_burn ?? 0);
      netDailyBurnTzs = Number.isFinite(parsed) ? parsed : null;
    }
  } else {
    moduleLogger.warn('daily-burn read failed — runway input unknown', {
      tenantId,
      reason: messageOf(burnResult.reason),
    });
  }

  return { cashOnHandTzs, netDailyBurnTzs };
}

export async function getCockpitProductionVsTarget(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof ProductionSlotSchema>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const rows = ((await db
    .select({
      siteId: shiftReports.siteId,
      tonnes: sql<number>`COALESCE(SUM(${shiftReports.romTonnes}), 0)`,
      fuel: sql<number>`COALESCE(SUM(${shiftReports.fuelLitres}), 0)`,
      shifts: sql<number>`COUNT(*)`,
    })
    .from(shiftReports)
    .where(
      and(
        eq(shiftReports.tenantId, tenantId),
        gte(shiftReports.shiftDate, dayKey(cutoff)),
      ),
    )
    .groupBy(shiftReports.siteId)) ?? []) as ReadonlyArray<{
    siteId: string | null;
    tonnes: number | string;
    fuel: number | string;
    shifts: number | string;
  }>;
  return {
    window: '30d' as const,
    perSite: rows.map((r) => ({
      siteId: r.siteId,
      tonnes: Number(r.tonnes ?? 0),
      fuel: Number(r.fuel ?? 0),
      shifts: Number(r.shifts ?? 0),
    })),
  };
}

export async function getCockpit27MarCliffStatus(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof CliffStatusSlotSchema>> {
  const cutoff = new Date('2026-03-27T00:00:00Z');
  // Aggregate in SQL over ALL post-cliff sales — never a capped JS fold. A
  // `.limit(500)` with no orderBy returned an arbitrary subset, so for a
  // tenant with >500 post-cliff sales the USD-denominated ones could fall
  // outside the window → `usdDenom === 0` falsely flipped `remediationComplete`
  // to a green "all-clear" while USD contracts still existed (compliance
  // banner lies). COUNT(*) FILTER counts every matching row, bounded to 1 row.
  const [agg] = ((await db
    .select({
      total: sql<number>`count(*)::int`,
      usd: sql<number>`count(*) filter (where ${sales.grossPriceUsd} is not null and ${sales.grossPriceUsd} > 0)::int`,
    })
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.ts, cutoff)))) ??
    []) as ReadonlyArray<{
    total?: number | string | null;
    usd?: number | string | null;
  }>;
  const postCliffSales = Number(agg?.total ?? 0);
  const usdDenom = Number(agg?.usd ?? 0);
  return {
    cliffDateIso: cutoff.toISOString(),
    postCliffSales,
    usdDenominated: usdDenom,
    remediationComplete: usdDenom === 0,
  };
}

export async function getOpenHighIncidents(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof OpenHighIncidentsSlotSchema>> {
  // The SAFETY count must be the TRUE total of open critical/high incidents,
  // not the critical/high subset WITHIN the newest 25 — a `.limit(25)` then
  // JS filter undercounted (falsely-low / green safety KPI) for any tenant
  // with >25 open incidents. Severity filter + COUNT run in SQL; the item
  // list stays capped at 25 for display but is now pre-filtered so it never
  // shows fewer than exist.
  const highSeverity = sql`${incidents.severity} in ('critical', 'high')`;
  const [agg] = ((await db
    .select({ total: sql<number>`count(*)::int` })
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        eq(incidents.status, 'open'),
        highSeverity,
      ),
    )) ?? []) as ReadonlyArray<{ total?: number | string | null }>;
  const totalHigh = Number(agg?.total ?? 0);
  const rows = ((await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.tenantId, tenantId),
        eq(incidents.status, 'open'),
        highSeverity,
      ),
    )
    .orderBy(desc(incidents.occurredAt))
    .limit(25)) ?? []) as ReadonlyArray<{
    id: string;
    severity?: string | null;
    kind?: string | null;
    occurredAt?: Date | string | null;
  }>;
  return {
    count: totalHigh,
    items: rows.map((r) => ({
      id: r.id,
      severity: String(r.severity ?? 'high'),
      kind: String(r.kind ?? 'incident'),
      occurredAt:
        r.occurredAt == null
          ? null
          : r.occurredAt instanceof Date
            ? r.occurredAt.toISOString()
            : String(r.occurredAt),
    })),
  };
}

export async function getLicenceHealth(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof LicenceHealthSlotSchema>> {
  const rows = ((await db
    .select()
    .from(licences)
    .where(eq(licences.tenantId, tenantId))
    .orderBy(desc(licences.dormancyScore))) ?? []) as ReadonlyArray<{
    id: string;
    number?: string | null;
    kind?: string | null;
    expiryDate?: string | null;
    dormancyScore?: number | null;
  }>;
  const enriched = rows.map((row) => {
    const expiry = row.expiryDate ? new Date(row.expiryDate) : null;
    const daysToExpiry = expiry
      ? Math.round((expiry.getTime() - Date.now()) / 86_400_000)
      : null;
    return {
      id: row.id,
      number: row.number ?? null,
      kind: row.kind ?? null,
      daysToExpiry,
      atRisk:
        (row.dormancyScore ?? 0) >= 60 ||
        (daysToExpiry !== null && daysToExpiry <= 90),
    };
  });
  return {
    totalCount: enriched.length,
    atRiskCount: enriched.filter((r) => r.atRisk).length,
    items: enriched.slice(0, 25),
  };
}

// ----------------------------------------------------------------------------
// composeOwnerBrief — single fan-out used by both BFF and cron.
// ----------------------------------------------------------------------------

/**
 * Active locale the brief's model-authored advisor slice is pinned to.
 * Resolved from the owner's active cockpit locale (the `borjie_locale`
 * cookie, falling back to `Accept-Language`). EN default — the cron path
 * and older callers pass nothing and get the English advisor note.
 */
export type BriefLocale = 'en' | 'sw';

export async function composeOwnerBrief(
  db: any,
  tenantId: string,
  locale: BriefLocale = 'en',
): Promise<OwnerBrief> {
  // mfr-9: fan out the seven slots with Promise.allSettled so ONE
  // transient slot failure (e.g. a flaky decisions query) degrades only
  // that slot to its safe empty shape rather than rejecting the whole
  // brief and 500-ing a request whose other six slots are healthy. Each
  // rejected slot is logged and falls back to the same empty shape its
  // own getter returns on no-data, so the OwnerBriefSchema still passes.
  const today = dayKey(new Date());
  const settled = await Promise.allSettled([
    getCockpitDailyBrief(db, tenantId),
    getCockpitDecisions(db, tenantId),
    getCockpitCashRunway(db, tenantId),
    getCockpitProductionVsTarget(db, tenantId),
    getCockpit27MarCliffStatus(db, tenantId),
    getOpenHighIncidents(db, tenantId),
    getLicenceHealth(db, tenantId),
  ]);

  function slotOr<T>(
    index: number,
    label: string,
    fallback: T,
  ): T {
    const r = settled[index];
    if (r && r.status === 'fulfilled') return r.value as T;
    moduleLogger.warn('owner-brief slot degraded to fallback', {
      tenantId,
      slot: label,
      reason: r && r.status === 'rejected' ? messageOf(r.reason) : 'unknown',
    });
    return fallback;
  }

  const dailyBrief = slotOr(0, 'dailyBrief', {
    date: today,
    shiftsToday: 0,
    openIncidents: 0,
    openGrievances: 0,
    criticalIncidents: 0,
  } as z.infer<typeof DailyBriefSlotSchema>);
  const decisions = slotOr(1, 'decisions', {
    pendingCount: 0,
    items: [],
  } as z.infer<typeof DecisionsSlotSchema>);
  const cashRunway = slotOr(2, 'cashRunway', {
    ninetyDayNetTzs: 0,
    dailyAvgTzs: 0,
    sampleCount: 0,
    // Degraded slot → honest unknown runway, never a fabricated number.
    cashOnHandTzs: null,
    netDailyBurnTzs: null,
    runwayDays: null,
    burnStatus: 'unknown',
  } as z.infer<typeof CashRunwaySlotSchema>);
  const productionVsTarget = slotOr(3, 'productionVsTarget', {
    window: '30d',
    perSite: [],
  } as z.infer<typeof ProductionSlotSchema>);
  const cliffStatus = slotOr(4, 'cliffStatus', {
    cliffDateIso: new Date('2026-03-27T00:00:00.000Z').toISOString(),
    postCliffSales: 0,
    usdDenominated: 0,
    remediationComplete: false,
  } as z.infer<typeof CliffStatusSlotSchema>);
  const openHighIncidents = slotOr(5, 'openHighIncidents', {
    count: 0,
    items: [],
  } as z.infer<typeof OpenHighIncidentsSlotSchema>);
  const licenceHealth = slotOr(6, 'licenceHealth', {
    totalCount: 0,
    atRiskCount: 0,
    items: [],
  } as z.infer<typeof LicenceHealthSlotSchema>);
  // Best-effort advisor slice — Wave OWNER-OS. If the brain ladder is
  // unwired or every provider errors we surface `advisor: null` and the
  // FE simply hides the sticky note chip. Never blocks the brief.
  const advisor = await composeAdvisorSlice(
    {
      dailyBrief,
      decisions,
      cashRunway,
      productionVsTarget,
      cliffStatus,
      openHighIncidents,
      licenceHealth,
    },
    tenantId,
    locale,
  ).catch((err) => {
    moduleLogger.warn('advisor slice failed', {
      tenantId,
      reason: messageOf(err),
    });
    return null;
  });
  return {
    schemaVersion: 1,
    composedAtIso: new Date().toISOString(),
    dailyBrief,
    decisions,
    cashRunway,
    productionVsTarget,
    cliffStatus,
    openHighIncidents,
    licenceHealth,
    advisor,
  };
}

/**
 * One-shot brain call that turns the brief slots into a 2-sentence
 * strategic insight + 1 concrete action. Returns null if the brain
 * ladder is unavailable or every provider returns empty.
 */
async function composeAdvisorSlice(slots: {
  readonly dailyBrief: z.infer<typeof DailyBriefSlotSchema>;
  readonly decisions: z.infer<typeof DecisionsSlotSchema>;
  readonly cashRunway: z.infer<typeof CashRunwaySlotSchema>;
  readonly productionVsTarget: z.infer<typeof ProductionSlotSchema>;
  readonly cliffStatus: z.infer<typeof CliffStatusSlotSchema>;
  readonly openHighIncidents: z.infer<typeof OpenHighIncidentsSlotSchema>;
  readonly licenceHealth: z.infer<typeof LicenceHealthSlotSchema>;
}, tenantId: string, locale: BriefLocale = 'en'): Promise<z.infer<typeof AdvisorSlotSchema> | null> {
  // Lazy import so the brain-call helper isn't required when this file
  // is bundled for the cron worker (which sets no API keys).
  const { callBrainOnce } = await import('./brain-call.js');
  const summary = JSON.stringify({
    shiftsToday: slots.dailyBrief.shiftsToday,
    openIncidents: slots.dailyBrief.openIncidents,
    criticalIncidents: slots.dailyBrief.criticalIncidents,
    pendingDecisions: slots.decisions.pendingCount,
    cashNet90dTzs: slots.cashRunway.ninetyDayNetTzs,
    cashDailyAvgTzs: slots.cashRunway.dailyAvgTzs,
    cashOnHandTzs: slots.cashRunway.cashOnHandTzs,
    netDailyBurnTzs: slots.cashRunway.netDailyBurnTzs,
    cashRunwayDays: slots.cashRunway.runwayDays,
    cashBurnStatus: slots.cashRunway.burnStatus,
    productionPerSite: slots.productionVsTarget.perSite,
    cliffRemediation: slots.cliffStatus.remediationComplete,
    licencesAtRisk: slots.licenceHealth.atRiskCount,
    licencesTotal: slots.licenceHealth.totalCount,
  });
  // ZERO-MIX (language-engineering canon): the advisor slice is genuine
  // model-authored prose rendered RAW on the localized owner cockpit. PIN
  // the output to the owner's active locale — a single language per reply,
  // never a bilingual / code-switched note — so the Swahili owner gets a
  // Swahili insight and the English owner an English one. Same en/sw
  // system-prompt branch idiom as routes/owner/docs.hono.ts /explain.
  const systemPrompt =
    locale === 'sw'
      ? 'Wewe ni Bwana Mwikila, mshauri mkuu wa kimkakati wa Borjie kwa mmiliki wa mgodi nchini Tanzania. Soma muhtasari wa JSON na ujibu KWA KISWAHILI TU kwa mistari miwili mifupi KAMILI: mstari wa 1 ni ufahamu wako wa kimkakati (sentensi ≤2, bila utangulizi), mstari wa 2 unaanza na "ACTION:" ukifuatwa na hatua MOJA halisi inayofuata yenye maneno chini ya 14. Usichanganye lugha nyingine yoyote. Bila emoji, bila markdown, bila maelezo ya mtoa-huduma.'
      : 'You are Mr. Mwikila, the Borjie strategic advisor for a Tanzanian mining owner. Read the JSON brief and respond IN ENGLISH ONLY with EXACTLY two compact lines: line 1 is your strategic insight (≤2 sentences, no preamble), line 2 starts with "ACTION:" followed by ONE concrete next action under 14 words. Do not mix in any other language. No emoji, no markdown, no provider chatter.';
  const userPrompt = `Today's owner brief slots (JSON):\n${summary}`;
  let result: { text: string; provider: string; latencyMs: number };
  try {
    result = await callBrainOnce({
      systemPrompt,
      userPrompt,
      maxTokens: 280,
      // LANE B5 — admin control-plane routing for this tenant's advisor slice.
      tenantId,
      useCase: 'casual_chat',
      // Single-language refusal/guard copy follows the same pinned locale.
      lang: locale,
    });
  } catch {
    return null;
  }
  const lines = result.text.split('\n').map((l) => l.trim()).filter(Boolean);
  const insight = lines[0] ?? '';
  const actionLine = lines.find((l) => /^action[:\s]/i.test(l)) ?? lines[1] ?? '';
  const action = actionLine.replace(/^action[:\s]+/i, '').trim();
  if (!insight || !action) return null;
  // IP-EGRESS (CLOSE-G) — `insight` + `action` are model-authored prose: run
  // each through the FAIL-CLOSED egress firewall before they leave the gateway.
  // `provider` is the concrete LLM provider id — it is coarsened to a generic,
  // non-identifying label so the model/provider identity never crosses the wire
  // (the real provider stays in the server log via callBrainOnce).
  return {
    insight: guardAdvisorText(insight, tenantId),
    action: guardAdvisorText(action, tenantId),
    generatedAtIso: new Date().toISOString(),
    provider: 'brain',
    latencyMs: result.latencyMs,
    // The locale the prose was authored in — the FE attributes it with this.
    lang: locale,
  };
}

// ----------------------------------------------------------------------------
// Persistence helpers — read cache, write snapshot, hash-chain the audit.
// ----------------------------------------------------------------------------

export interface SnapshotReadResult {
  readonly brief: OwnerBrief;
  readonly source: 'cron' | 'on-demand' | 'daily_cron';
  readonly generatedAtIso: string;
}

export async function readTodaysSnapshot(
  db: any,
  tenantId: string,
  now: Date = new Date(),
): Promise<SnapshotReadResult | null> {
  const today = dayKey(now);
  const rows = ((await db
    .select()
    .from(ownerBriefSnapshots)
    .where(
      and(
        eq(ownerBriefSnapshots.tenantId, tenantId),
        eq(ownerBriefSnapshots.snapshotDate, today),
      ),
    )
    .orderBy(desc(ownerBriefSnapshots.generatedAt))
    .limit(1)) ?? []) as ReadonlyArray<{
    brief: unknown;
    source?: string | null;
    generatedAt?: Date | string | null;
  }>;
  if (rows.length === 0) return null;
  const row = rows[0]!;
  const parsed = OwnerBriefSchema.safeParse(row.brief);
  if (!parsed.success) {
    moduleLogger.warn('cached snapshot failed schema validation', {
      tenantId,
      issues: parsed.error.issues.length,
    });
    return null;
  }
  const generatedAtIso =
    row.generatedAt instanceof Date
      ? row.generatedAt.toISOString()
      : String(row.generatedAt ?? new Date().toISOString());
  const sourceValue: 'cron' | 'on-demand' | 'daily_cron' =
    row.source === 'daily_cron'
      ? 'daily_cron'
      : row.source === 'cron'
        ? 'cron'
        : 'on-demand';
  return {
    brief: parsed.data,
    source: sourceValue,
    generatedAtIso,
  };
}

export async function persistSnapshot(
  db: any,
  args: {
    readonly tenantId: string;
    readonly brief: OwnerBrief;
    readonly source: 'cron' | 'on-demand' | 'daily_cron';
    readonly now?: Date;
  },
): Promise<{ readonly id: string; readonly hashChainId: string | null }> {
  const now = args.now ?? new Date();
  const today = dayKey(now);
  const hashChainId = await appendAuditChainEntry(db, {
    tenantId: args.tenantId,
    brief: args.brief,
    source: args.source,
    now,
  });
  const result = await db.execute(
    sql`
      INSERT INTO owner_brief_snapshots
        (tenant_id, snapshot_date, generated_at, brief, source, hash_chain_id)
      VALUES
        (${args.tenantId}::uuid,
         ${today}::date,
         ${now.toISOString()}::timestamptz,
         ${JSON.stringify(args.brief)}::jsonb,
         ${args.source},
         ${hashChainId}::uuid)
      ON CONFLICT (tenant_id, snapshot_date)
      DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        brief        = EXCLUDED.brief,
        source       = EXCLUDED.source,
        hash_chain_id = EXCLUDED.hash_chain_id
      RETURNING id::text, hash_chain_id::text
    `,
  );
  const row = rowsOf(result)[0] as
    | { id?: unknown; hash_chain_id?: unknown }
    | undefined;
  return {
    id: String(row?.id ?? ''),
    hashChainId:
      row?.hash_chain_id == null ? null : String(row.hash_chain_id),
  };
}

/**
 * Append an `ai_audit_chain` entry recording this snapshot composition.
 * Best-effort: chain append failure does NOT block the snapshot write;
 * we log + persist with hash_chain_id=NULL so the gap is observable.
 */
async function appendAuditChainEntry(
  db: any,
  args: {
    readonly tenantId: string;
    readonly brief: OwnerBrief;
    readonly source: 'cron' | 'on-demand' | 'daily_cron';
    readonly now: Date;
  },
): Promise<string | null> {
  try {
    // Hash-chain primitive: link to prev row by (tenant_id, sequence_id).
    // We synthesise minimal fields so the row is verifier-walkable; the
    // brain's broader hash-chain workflow keeps the full HMAC pipeline.
    const id = randomUUID();
    const turnId = `owner-brief-${dayKey(args.now)}`;
    const briefJson = JSON.stringify(args.brief);
    const result = await db.execute(
      sql`
        WITH prev AS (
          SELECT this_hash, sequence_id
            FROM ai_audit_chain
           WHERE tenant_id = ${args.tenantId}
           ORDER BY sequence_id DESC
           LIMIT 1
        )
        INSERT INTO ai_audit_chain
          (id, tenant_id, sequence_id, turn_id, session_id, action,
           prev_hash, this_hash, payload_ref, payload, created_at)
        VALUES (
          ${id},
          ${args.tenantId},
          COALESCE((SELECT sequence_id FROM prev), 0) + 1,
          ${turnId},
          NULL,
          ${`owner.brief.snapshot.${args.source}`},
          COALESCE((SELECT this_hash FROM prev), ''),
          encode(sha256(
            (COALESCE((SELECT this_hash FROM prev), '') || ${briefJson})::bytea
          ), 'hex'),
          NULL,
          ${briefJson}::jsonb,
          ${args.now.toISOString()}::timestamptz
        )
        RETURNING id::text
      `,
    );
    const row = rowsOf(result)[0] as { id?: unknown } | undefined;
    return row?.id == null ? null : String(row.id);
  } catch (err) {
    moduleLogger.warn('audit-chain append failed for owner brief', {
      tenantId: args.tenantId,
      source: args.source,
      reason: messageOf(err),
    });
    return null;
  }
}

// ----------------------------------------------------------------------------
// Hono route factory.
// ----------------------------------------------------------------------------

export function createOwnerBriefRouter(): Hono {
  const app = new Hono();

  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.get('/', async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId?: string; userId?: string }
      | undefined;
    if (!auth?.tenantId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'tenant must be bound on the auth context',
          },
        },
        401,
      );
    }

    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'OWNER_BRIEF_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }

    // ZERO-MIX: the owner's ACTIVE cockpit locale. Drives the advisor LLM
    // pin AND gates whether a cached advisor note (authored once per
    // tenant/day, possibly by the 06:00 cron in a different language) may be
    // served — a wrong-language note is mixing, so it is withheld.
    const locale = resolveBriefLocale(
      c.req.header('cookie'),
      c.req.header('accept-language'),
    );

    try {
      const cached = await readTodaysSnapshot(db, auth.tenantId);
      if (cached) {
        return c.json(
          {
            success: true,
            data: {
              // The non-advisor slots are locale-neutral (stable codes the FE
              // localizes); only the advisor prose is language-bearing. If the
              // cached note was authored in another locale, withhold it (null)
              // rather than render it raw on the active-locale surface — the FE
              // simply hides the advisor chip. The owner's next on-demand
              // compose re-authors it in their language.
              brief: briefForLocale(cached.brief, locale),
              source: cached.source,
              generatedAt: cached.generatedAtIso,
              cached: true,
            },
          },
          200,
        );
      }

      const brief = await composeOwnerBrief(db, auth.tenantId, locale);
      const persisted = await persistSnapshot(db, {
        tenantId: auth.tenantId,
        brief,
        source: 'on-demand',
      });
      return c.json(
        {
          success: true,
          data: {
            brief,
            source: 'on-demand' as const,
            generatedAt: brief.composedAtIso,
            cached: false,
            snapshotId: persisted.id,
          },
        },
        200,
      );
    } catch (err) {
      const reason = messageOf(err);
      moduleLogger.error('owner brief composition failed', {
        evt: 'owner_brief_failed',
        tenantId: auth.tenantId,
        reason,
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'OWNER_BRIEF_FAILED',
            message: reason,
          },
        },
        500,
      );
    }
  });

  return app;
}

export const ownerBriefRouter = createOwnerBriefRouter();
export default ownerBriefRouter;

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Resolve the owner's ACTIVE cockpit locale for the advisor LLM pin.
 *
 * The single source of truth is the `borjie_locale` cookie the owner-web
 * locale toggle writes (forwarded via `credentials: 'include'`). It is the
 * active SURFACE locale — which `Accept-Language` (the browser default) is
 * NOT. We therefore prefer the cookie and fall back to `Accept-Language`,
 * defaulting to `en`. Returns only the two supported locales so the model
 * is pinned to a single language (zero-mix canon).
 */
function resolveBriefLocale(
  cookieHeader: string | null | undefined,
  acceptLanguage: string | null | undefined,
): BriefLocale {
  if (typeof cookieHeader === 'string' && cookieHeader.length > 0) {
    const m = cookieHeader.match(/(?:^|;\s*)borjie_locale=([^;]+)/);
    const cookieVal = m?.[1]?.trim().toLowerCase();
    if (cookieVal === 'sw') return 'sw';
    if (cookieVal === 'en') return 'en';
  }
  if (typeof acceptLanguage === 'string' && acceptLanguage.length > 0) {
    const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? '';
    if (first.startsWith('sw')) return 'sw';
  }
  return 'en';
}

/**
 * ZERO-MIX gate on a CACHED brief: the advisor slice is the only
 * language-bearing slot. If its authored `lang` does not match the owner's
 * active locale, strip it (the FE hides the chip) so a cached note never
 * renders in the wrong language. All other slots are locale-neutral and
 * pass through untouched. Immutable — returns a new object, never mutates.
 */
function briefForLocale(brief: OwnerBrief, locale: BriefLocale): OwnerBrief {
  const advisorLang = brief.advisor?.lang ?? 'en';
  if (!brief.advisor || advisorLang === locale) return brief;
  return { ...brief, advisor: null };
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = (result as { rows?: unknown }).rows;
  return Array.isArray(wrapped)
    ? (wrapped as ReadonlyArray<Record<string, unknown>>)
    : [];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Suppress unused warning — type alias kept for future strong-typing of db arg.
type _Unused_DrizzleLikeClient = DrizzleLikeClient;
