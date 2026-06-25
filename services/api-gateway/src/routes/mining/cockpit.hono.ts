/**
 * /api/v1/mining/cockpit — owner strategic cockpit widgets.
 *
 * Routes:
 *   GET  /daily-brief             one-glance start-of-day (FULL DailyBriefResponse)
 *   GET  /cash-runway             days-of-cash projection
 *   GET  /licence-health          dormancy + expiry-risk per licence
 *   GET  /production-vs-target    rolling 30-day production gap
 *   GET  /27mar-cliff-status      USD-cliff remediation rollup
 *   GET  /decisions               pending owner-decision queue (B-MgrDispatch)
 *   GET  /sic-pings               supervisor SIC ping queue (migration 0082)
 *   POST /sic-pings               worker SIC-ping reply (WF-6, migration 0285)
 *   POST /sic-pings/:id/reply     worker reply targeting a concrete ping
 *
 * Migrated to `@hono/zod-openapi` (issue #19). Route definitions live
 * in `./_openapi/route-defs.ts` so the static spec generator can
 * register them without importing this file's middleware + DB code.
 *
 * owner-ceo-1 fix: GET /daily-brief now fans out to ALL slot computers
 * from brief.hono.ts and returns the FULL DailyBriefResponse shape that
 * CockpitGrid.tsx expects. Previously the narrow shape caused 8/10 cards
 * to crash on undefined property dereferences.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  licences,
  shiftReports,
  sales,
  incidents,
  grievances,
  miningApprovalItems,
  miningSicPings,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  persistSicPingReply,
  sicPingReplyBodySchema,
  type SicReplyWriter,
} from '../../services/sic-ping-reply';
import {
  cockpitCashRunwayRoute,
  cockpitLicenceHealthRoute,
  cockpitProductionVsTargetRoute,
  cockpitCliffStatusRoute,
} from './_openapi/route-defs';
import {
  getCockpitDailyBrief,
  getCockpitCashRunway,
  getCockpitProductionVsTarget,
  getCockpit27MarCliffStatus,
  getOpenHighIncidents,
  getLicenceHealth,
  getCockpitDecisions,
} from '../owner/brief.hono.js';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-cockpit');

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/**
 * Latest gold-spot (USD/oz) + TZS→USD from the `fx_rates` benchmark feed.
 *
 * Returns `null` for any pair the feed has not yet written, so a downstream
 * card distinguishes "feed not wired / empty" from a real numeric quote.
 * `fx_rates` is tenant-agnostic (global LBMA/BoT benchmarks) — the database
 * middleware merely opens the session; no `app.current_tenant_id` is bound.
 *
 * `XAU_USD_PM` is the canonical afternoon gold fix; we fall back to the AM fix
 * when PM is absent. Each rate is parsed through `Number.isFinite` so a NULL /
 * non-numeric DB value can never reach the wire as `NaN`.
 */
async function getLatestFxQuotes(db: {
  execute(q: unknown): Promise<{ rows: ReadonlyArray<{ pair: string; rate: string }> }>;
}): Promise<{ goldSpotUsdOz: number | null; tzsUsd: number | null }> {
  const result = await db.execute(sql`
    SELECT DISTINCT ON (pair) pair, rate::text AS rate
    FROM fx_rates
    WHERE pair IN ('TZS_USD', 'XAU_USD_PM', 'XAU_USD_AM')
    ORDER BY pair, ts DESC
  `);
  const byPair = new Map<string, number>();
  for (const row of result.rows ?? []) {
    const parsed = Number(row.rate);
    if (Number.isFinite(parsed) && parsed > 0) byPair.set(row.pair, parsed);
  }
  return {
    goldSpotUsdOz: byPair.get('XAU_USD_PM') ?? byPair.get('XAU_USD_AM') ?? null,
    tzsUsd: byPair.get('TZS_USD') ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /daily-brief — FULL DailyBriefResponse (owner-ceo-1 fix).
//
// Fans out to all slot computers in parallel (Promise.allSettled so a
// single slot failure degrades gracefully rather than crashing all 10
// cards). Each missing slot falls back to a SAFE ZERO-PLACEHOLDER so the
// client card renders an honest empty state instead of a TypeError.
//
// Shape mirrors apps/owner-web/src/lib/types/cockpit.ts DailyBriefResponse.
// ---------------------------------------------------------------------------
app.get('/daily-brief', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db');

  if (!db) {
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'database not configured' } },
      503,
    );
  }

  const today = dayKey(new Date());

  const [
    dailyBriefResult,
    cashRunwayResult,
    productionResult,
    cliffResult,
    incidentsResult,
    licenceResult,
    decisionsResult,
    todayProductionResult,
    fxResult,
  ] = await Promise.allSettled([
    getCockpitDailyBrief(db, tenantId),
    getCockpitCashRunway(db, tenantId),
    getCockpitProductionVsTarget(db, tenantId),
    getCockpit27MarCliffStatus(db, tenantId),
    getOpenHighIncidents(db, tenantId),
    getLicenceHealth(db, tenantId),
    getCockpitDecisions(db, tenantId),
    // Today-scoped production: shiftDate = today only, not 30 days.
    db
      .select({
        tonnes: sql<number>`COALESCE(SUM(${shiftReports.romTonnes}), 0)`,
      })
      .from(shiftReports)
      .where(and(eq(shiftReports.tenantId, tenantId), eq(shiftReports.shiftDate, today)))
      .then((rows: ReadonlyArray<{ tonnes: number | string }>) => ({
        tonnesToday: Number((rows[0] as { tonnes: number | string } | undefined)?.tonnes ?? 0),
      })),
    // FX & gold — REAL source. `fx_rates` is the tenant-agnostic LBMA/BoT
    // benchmark feed the fx-feed cron appends to (see mining/fx.hono.ts).
    // We read the latest TZS_USD + XAU_USD_PM rows. A missing/empty feed
    // surfaces as `null` (feed-not-wired) — never a fabricated 0 that a card
    // would render as a real quote (failure ≠ emptiness ≠ honest zero).
    getLatestFxQuotes(db),
  ]);

  function slotOr<T>(result: PromiseSettledResult<T>, label: string, fallback: T): T {
    if (result.status === 'fulfilled') return result.value;
    moduleLogger.warn('cockpit daily-brief slot degraded', {
      tenantId,
      slot: label,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return fallback;
  }

  const brief = slotOr(dailyBriefResult, 'dailyBrief', {
    date: today,
    shiftsToday: 0,
    openIncidents: 0,
    openGrievances: 0,
    criticalIncidents: 0,
  });

  const cash = slotOr(cashRunwayResult, 'cashRunway', {
    ninetyDayNetTzs: 0,
    dailyAvgTzs: 0,
    sampleCount: 0,
  });

  const production = slotOr(productionResult, 'productionVsTarget', {
    window: '30d' as const,
    perSite: [],
  });

  const cliff = slotOr(cliffResult, 'cliffStatus', {
    cliffDateIso: new Date('2026-03-27T00:00:00Z').toISOString(),
    postCliffSales: 0,
    usdDenominated: 0,
    remediationComplete: false,
  });

  const openIncidentSlot = slotOr(incidentsResult, 'openHighIncidents', {
    count: 0,
    items: [],
  });

  const licenceSlot = slotOr(licenceResult, 'licenceHealth', {
    totalCount: 0,
    atRiskCount: 0,
    items: [],
  });

  const decisionsSlot = slotOr(decisionsResult, 'decisions', {
    pendingCount: 0,
    items: [],
  });

  // ── Derive DailyBriefResponse shape fields ──────────────────────────────

  // cash metrics — ninetyDayNetTzs is the inflow signal; convert to millions
  const cashTzsMillions = cash.ninetyDayNetTzs / 1_000_000;
  const burnPerDayTzsMillions = cash.dailyAvgTzs / 1_000_000;
  // runwayDays: cash / burn. Guard against divide-by-zero.
  const runwayDays =
    cash.dailyAvgTzs > 0
      ? Math.round(cash.ninetyDayNetTzs / cash.dailyAvgTzs)
      : 0;

  // Today-scoped production — use the dedicated today query result.
  // Returns 0 on slot failure (safe zero-placeholder, never fabricated).
  const todayProduction = slotOr(
    todayProductionResult as PromiseSettledResult<{ tonnesToday: number }>,
    'todayProduction',
    { tonnesToday: 0 },
  );
  const tonnesToday = todayProduction.tonnesToday;

  // Month-to-date (30-day rolling) production from the productionVsTarget slot.
  // Labelled honestly as 30d, never as "today".
  const tonnes30d = production.perSite.reduce((s, r) => s + Number(r.tonnes ?? 0), 0);

  // activeSites — each site row from production (30-day window, labelled honestly)
  const activeSites = production.perSite.slice(0, 10).map((r) => {
    const siteId = r.siteId ?? 'unknown';
    const tonnes = Number(r.tonnes ?? 0);
    return {
      name: siteId,
      status: (tonnes > 0 ? 'on-track' : 'watch') as 'on-track' | 'watch' | 'behind',
      headline: `${tonnes.toFixed(1)} t (30d ROM)`,
    };
  });

  // openRisks — from open high incidents
  const openRisks = openIncidentSlot.items.slice(0, 10).map((r) => ({
    title: `${r.kind} · ${r.id.slice(0, 8)}`,
    site: 'n/a',
    severity: (
      r.severity === 'critical' ? 'high' : r.severity === 'high' ? 'high' : 'medium'
    ) as 'low' | 'medium' | 'high',
  }));

  // pendingDecisions
  const pendingDecisions = decisionsSlot.items.slice(0, 10).map((r) => ({
    title: r.summary,
    waitingDays: 0,
    recommender: r.kind,
  }));

  // compliance — infer from licenceHealth risk tiers
  const amber = licenceSlot.atRiskCount;
  const green = Math.max(0, licenceSlot.totalCount - amber);
  const red = openIncidentSlot.items.filter((r) => r.severity === 'critical').length;

  // dailyBrief items list (the "brief" items the CockpitGrid shows)
  const dailyBriefItems: Array<{ text: string; textSw: string; severity: 'info' | 'warn' | 'critical' }> = [];
  if (brief.criticalIncidents > 0) {
    dailyBriefItems.push({
      text: `${brief.criticalIncidents} critical incident${brief.criticalIncidents === 1 ? '' : 's'} open`,
      textSw: `Matukio ${brief.criticalIncidents} muhimu wazi`,
      severity: 'critical',
    });
  }
  if (brief.openGrievances > 0) {
    dailyBriefItems.push({
      text: `${brief.openGrievances} open grievance${brief.openGrievances === 1 ? '' : 's'}`,
      textSw: `Malalamiko ${brief.openGrievances} wazi`,
      severity: 'warn',
    });
  }
  if (brief.shiftsToday > 0) {
    dailyBriefItems.push({
      text: `${brief.shiftsToday} shift report${brief.shiftsToday === 1 ? '' : 's'} today`,
      textSw: `Ripoti ${brief.shiftsToday} za zamu leo`,
      severity: 'info',
    });
  }

  // FX & gold come from the real `fx_rates` benchmark feed (fxResult slot).
  // A missing feed yields `null` per pair — the card renders an honest
  // em-dash, never a fabricated $0/oz or TZS/USD 0.
  const fx = slotOr(
    fxResult as PromiseSettledResult<{
      goldSpotUsdOz: number | null;
      tzsUsd: number | null;
    }>,
    'fxQuotes',
    { goldSpotUsdOz: null, tzsUsd: null },
  );

  const daysToCliff27Mar = Math.max(
    0,
    Math.round(
      (new Date('2026-03-27T00:00:00Z').getTime() - Date.now()) / 86_400_000,
    ),
  );

  return c.json(
    {
      success: true as const,
      data: {
        dailyBrief: dailyBriefItems,
        cashTzsMillions,
        runwayDays,
        burnPerDayTzsMillions,
        licences: {
          active: licenceSlot.totalCount,
          renewalsDue60d: licenceSlot.items.filter(
            (r) => r.daysToExpiry !== null && r.daysToExpiry <= 60 && r.daysToExpiry >= 0,
          ).length,
          dormancyFlags: licenceSlot.atRiskCount,
        },
        production: {
          // tonnesToday: today-scoped query (shiftDate = today).
          // grammesMtd: 30-day rolling ROM tonnes (no × 1000 proxy).
          // grammesToday: raw today tonnes (no synthetic conversion).
          grammesToday: tonnesToday,
          grammesTargetToday: 0,
          grammesMtd: tonnes30d,
          grammesTargetMtd: 0,
        },
        openRisks,
        pendingDecisions,
        activeSites,
        compliance: { green, amber, red },
        // Marketplace activity has no backing table in this deployment yet
        // (no listings / inquiries schema). Emitting `0`/`''` would render as
        // a real "zero offers / no buyer" fact — a fabricated emptiness. We
        // emit `null` so the card shows an honest "not wired" em-dash,
        // distinguishing an absent feed from a genuine zero.
        marketplace: {
          openOffers: null,
          newInquiries7d: null,
          topBuyer: null,
        },
        // Gold spot + TZS/USD from the live `fx_rates` feed (null when the
        // fx-feed cron has not yet written that pair).
        fxAndGold: {
          goldSpotUsdOz: fx.goldSpotUsdOz,
          tzsUsd: fx.tzsUsd,
          sellWindowOpen: cliff.remediationComplete,
          daysToCliff27Mar,
        },
        updatedAt: new Date().toISOString(),
        tenantId,
      },
    },
    200,
  );
});

app.openapi(cockpitCashRunwayRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const recentSales = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.ts, cutoff)))
    .orderBy(desc(sales.ts));
  const ninetyDayNetTzs = recentSales.reduce(
    (sum, s) => sum + Number(s.netTzs ?? 0),
    0,
  );
  const dailyAvgTzs = ninetyDayNetTzs / 90;
  return c.json(
    {
      success: true as const,
      data: {
        ninetyDayNetTzs,
        dailyAvgTzs,
        sampleCount: recentSales.length,
        note: 'Runway computation defers to ledger service for outflows; this surfaces inflow signal only.',
      },
    },
    200,
  );
});

app.openapi(cockpitLicenceHealthRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const rows = await db
    .select()
    .from(licences)
    .where(eq(licences.tenantId, tenantId))
    .orderBy(desc(licences.dormancyScore));
  const enriched = rows.map((row) => {
    const expiry = row.expiryDate ? new Date(row.expiryDate as unknown as string) : null;
    const daysToExpiry = expiry
      ? Math.round((expiry.getTime() - Date.now()) / 86_400_000)
      : null;
    return {
      ...row,
      daysToExpiry,
      atRisk:
        (row.dormancyScore ?? 0) >= 60 ||
        (daysToExpiry !== null && daysToExpiry <= 90),
    };
  });
  return c.json({ success: true as const, data: enriched }, 200);
});

app.openapi(cockpitProductionVsTargetRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const rows = await db
    .select({
      siteId: shiftReports.siteId,
      tonnes: sql<number>`COALESCE(SUM(${shiftReports.romTonnes}), 0)`,
      fuel: sql<number>`COALESCE(SUM(${shiftReports.fuelLitres}), 0)`,
      shifts: sql<number>`COUNT(*)`,
    })
    .from(shiftReports)
    .where(and(eq(shiftReports.tenantId, tenantId), gte(shiftReports.shiftDate, dayKey(cutoff))))
    .groupBy(shiftReports.siteId);
  return c.json(
    { success: true as const, data: { window: '30d' as const, perSite: rows } },
    200,
  );
});

app.openapi(cockpitCliffStatusRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const cutoff = new Date('2026-03-27T00:00:00Z');
  const usdSales = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.ts, cutoff)))
    .limit(500);
  const usdDenom = usdSales.filter((s) => Number(s.grossPriceUsd ?? 0) > 0).length;
  return c.json(
    {
      success: true as const,
      data: {
        cliffDateIso: cutoff.toISOString(),
        postCliffSales: usdSales.length,
        usdDenominated: usdDenom,
        remediationComplete: usdDenom === 0,
        // WIRE STAYS LOCALE-NEUTRAL: emit a stable key, never single-language
        // prose. The owner-web CliffBanner renders the remediation guidance
        // from its localized treasury-page string table (S.cliff.remediation)
        // in the ACTIVE locale — the backend never ships English copy here.
        note: 'tzs_primary_settlement_required',
      },
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /decisions — pending owner-decision queue.
//
// Sources from `mining_approval_items` (B-MgrDispatch, migration 0081).
// Only rows targeted at the current authenticated user as approver, with
// status = 'pending', are returned. The mobile wiring agent surfaces
// these in the owner cockpit widget.
//
// If the `mining_approval_items` table is missing, the handler returns
// `{ items: [], note: 'awaiting B-Manager migration 0081' }` with 200.
// ---------------------------------------------------------------------------
app.get('/decisions', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: true as const,
        data: {
          items: [] as const,
          note: 'database not configured',
        },
      },
      200,
    );
  }
  try {
    const rows = await db
      .select()
      .from(miningApprovalItems)
      .where(
        and(
          eq(miningApprovalItems.tenantId, tenantId),
          eq(miningApprovalItems.approverUserId, userId),
          eq(miningApprovalItems.status, 'pending'),
        ),
      )
      .orderBy(desc(miningApprovalItems.createdAt))
      .limit(100);
    return c.json({ success: true as const, data: { items: rows } }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /relation\s+"?mining_approval_items"?\s+does not exist/i.test(message) ||
      /no such table:?\s*mining_approval_items/i.test(message)
    ) {
      moduleLogger.warn(
        'mining_approval_items missing — returning empty decisions queue',
        { tenantId },
      );
      return c.json(
        {
          success: true as const,
          data: {
            items: [] as const,
            note: 'awaiting B-Manager migration 0081',
          },
        },
        200,
      );
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /sic-pings — supervisor Short Interval Control ping queue.
//
// Reads `mining_sic_pings` (migration 0082) newest-first. Bounded to the
// last 100 pings; the owner cockpit widget renders the top N.
// ---------------------------------------------------------------------------
app.get('/sic-pings', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: true as const,
        data: { items: [] as const, note: 'database not configured' },
      },
      200,
    );
  }
  try {
    const rows = await db
      .select()
      .from(miningSicPings)
      .where(eq(miningSicPings.tenantId, tenantId))
      .orderBy(desc(miningSicPings.pingedAt))
      .limit(100);
    return c.json({ success: true as const, data: { items: rows } }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /relation\s+"?mining_sic_pings"?\s+does not exist/i.test(message) ||
      /no such table:?\s*mining_sic_pings/i.test(message)
    ) {
      moduleLogger.warn(
        'mining_sic_pings missing — returning empty SIC ping queue',
        { tenantId },
      );
      return c.json(
        {
          success: true as const,
          data: { items: [] as const, note: 'awaiting migration 0082' },
        },
        200,
      );
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /sic-pings  +  POST /sic-pings/:id/reply — worker SIC-ping reply (WF-6).
//
// Persists a worker's quick reply (loads done + blockers + when) to the
// real `mining_sic_ping_replies` table (migration 0285). Until this
// landed, the workforce-mobile SIC screen (W-M-05) could only
// offline-queue replies — there was no reply column on `mining_sic_pings`
// and no endpoint. A reply is a distinct append-only fact, so it gets its
// own row rather than mutating the ping.
//
// Two mount shapes are served:
//   * POST /sic-pings            — the offline-queue flush target. The
//     workforce-mobile sync (`endpointFor('sic_ping')` → `sic-pings`,
//     composed under the mining prefix) POSTs the stored payload verbatim:
//       { pingId: 'ping-<epoch>', loads, blockers, repliedAtISO }
//     `pingId` here is a CLIENT-generated ref, not a real ping id, so it is
//     stored as `client_ping_ref` (no fabricated FK link).
//   * POST /sic-pings/:id/reply  — targets a concrete `mining_sic_pings.id`
//     (the `:id` is validated as a UUID and stored in the real `ping_id`
//     FK column).
//
// RLS: databaseMiddleware binds app.current_tenant_id; the replies table is
// FORCE-RLS. `replied_by_user_id` is the authenticated user.
// ---------------------------------------------------------------------------

async function handleSicPingReply(
  c: Context,
  opts: { readonly realPingId: string | null },
) {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db') as SicReplyWriter | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json(
      { success: false as const, error: { code: 'SIC_REPLY_DB_UNAVAILABLE' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsed = sicPingReplyBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', issues: parsed.error.issues },
      },
      400,
    );
  }
  const result = await persistSicPingReply(
    db,
    { tenantId: auth.tenantId, userId: auth.userId },
    parsed.data,
    opts,
  );
  if (result.ok) {
    return c.json(
      { success: true as const, data: { id: result.id } },
      201,
    );
  }
  return c.json(
    {
      success: false as const,
      error: {
        code: result.code,
        ...(result.note ? { note: result.note } : {}),
      },
    },
    result.status,
  );
}

app.post('/sic-pings', async (c) => handleSicPingReply(c, { realPingId: null }));

app.post('/sic-pings/:id/reply', async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_PING_ID', message: 'ping id must be a UUID' },
      },
      400,
    );
  }
  return handleSicPingReply(c, { realPingId: id });
});

export const miningCockpitRouter = app;
