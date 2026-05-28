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

const moduleLogger = createLogger('owner-brief');

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
  ninetyDayNetTzs: z.number(),
  dailyAvgTzs: z.number(),
  sampleCount: z.number().int().nonnegative(),
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
  try {
    const result = await db.execute(
      sql`
        SELECT id::text, 'incident' AS kind,
               COALESCE(description, kind, 'incident') AS summary,
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
      summary: String(r.summary ?? ''),
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

export async function getCockpitCashRunway(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof CashRunwaySlotSchema>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
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
  return {
    ninetyDayNetTzs,
    dailyAvgTzs,
    sampleCount: recentSales.length,
  };
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
  const usdSales = ((await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, tenantId), gte(sales.ts, cutoff)))
    .limit(500)) ?? []) as ReadonlyArray<{
    grossPriceUsd?: number | string | null;
  }>;
  const usdDenom = usdSales.filter(
    (s) => Number(s.grossPriceUsd ?? 0) > 0,
  ).length;
  return {
    cliffDateIso: cutoff.toISOString(),
    postCliffSales: usdSales.length,
    usdDenominated: usdDenom,
    remediationComplete: usdDenom === 0,
  };
}

export async function getOpenHighIncidents(
  db: any,
  tenantId: string,
): Promise<z.infer<typeof OpenHighIncidentsSlotSchema>> {
  const rows = ((await db
    .select()
    .from(incidents)
    .where(
      and(eq(incidents.tenantId, tenantId), eq(incidents.status, 'open')),
    )
    .orderBy(desc(incidents.occurredAt))
    .limit(25)) ?? []) as ReadonlyArray<{
    id: string;
    severity?: string | null;
    kind?: string | null;
    occurredAt?: Date | string | null;
  }>;
  const filtered = rows.filter(
    (r) => r.severity === 'critical' || r.severity === 'high',
  );
  return {
    count: filtered.length,
    items: filtered.map((r) => ({
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

export async function composeOwnerBrief(
  db: any,
  tenantId: string,
): Promise<OwnerBrief> {
  const [
    dailyBrief,
    decisions,
    cashRunway,
    productionVsTarget,
    cliffStatus,
    openHighIncidents,
    licenceHealth,
  ] = await Promise.all([
    getCockpitDailyBrief(db, tenantId),
    getCockpitDecisions(db, tenantId),
    getCockpitCashRunway(db, tenantId),
    getCockpitProductionVsTarget(db, tenantId),
    getCockpit27MarCliffStatus(db, tenantId),
    getOpenHighIncidents(db, tenantId),
    getLicenceHealth(db, tenantId),
  ]);
  // Best-effort advisor slice — Wave OWNER-OS. If the brain ladder is
  // unwired or every provider errors we surface `advisor: null` and the
  // FE simply hides the sticky note chip. Never blocks the brief.
  const advisor = await composeAdvisorSlice({
    dailyBrief,
    decisions,
    cashRunway,
    productionVsTarget,
    cliffStatus,
    openHighIncidents,
    licenceHealth,
  }).catch((err) => {
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
}): Promise<z.infer<typeof AdvisorSlotSchema> | null> {
  // Lazy import so the brain-call helper isn't required when this file
  // is bundled for the cron worker (which sets no API keys).
  const { callBrainOnce } = await import('./brain-call');
  const summary = JSON.stringify({
    shiftsToday: slots.dailyBrief.shiftsToday,
    openIncidents: slots.dailyBrief.openIncidents,
    criticalIncidents: slots.dailyBrief.criticalIncidents,
    pendingDecisions: slots.decisions.pendingCount,
    cashNet90dTzs: slots.cashRunway.ninetyDayNetTzs,
    cashDailyAvgTzs: slots.cashRunway.dailyAvgTzs,
    productionPerSite: slots.productionVsTarget.perSite,
    cliffRemediation: slots.cliffStatus.remediationComplete,
    licencesAtRisk: slots.licenceHealth.atRiskCount,
    licencesTotal: slots.licenceHealth.totalCount,
  });
  const systemPrompt =
    'You are Mr. Mwikila, the Borjie strategic advisor for a Tanzanian mining owner. Read the JSON brief and respond with EXACTLY two compact lines: line 1 is your strategic insight (≤2 sentences, no preamble), line 2 starts with "ACTION:" followed by ONE concrete next action under 14 words. No emoji, no markdown, no provider chatter.';
  const userPrompt = `Today's owner brief slots (JSON):\n${summary}`;
  let result: { text: string; provider: string; latencyMs: number };
  try {
    result = await callBrainOnce({ systemPrompt, userPrompt, maxTokens: 280 });
  } catch {
    return null;
  }
  const lines = result.text.split('\n').map((l) => l.trim()).filter(Boolean);
  const insight = lines[0] ?? '';
  const actionLine = lines.find((l) => /^action[:\s]/i.test(l)) ?? lines[1] ?? '';
  const action = actionLine.replace(/^action[:\s]+/i, '').trim();
  if (!insight || !action) return null;
  return {
    insight,
    action,
    generatedAtIso: new Date().toISOString(),
    provider: result.provider,
    latencyMs: result.latencyMs,
  };
}

// ----------------------------------------------------------------------------
// Persistence helpers — read cache, write snapshot, hash-chain the audit.
// ----------------------------------------------------------------------------

export interface SnapshotReadResult {
  readonly brief: OwnerBrief;
  readonly source: 'cron' | 'on-demand';
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
  return {
    brief: parsed.data,
    source: row.source === 'cron' ? 'cron' : 'on-demand',
    generatedAtIso,
  };
}

export async function persistSnapshot(
  db: any,
  args: {
    readonly tenantId: string;
    readonly brief: OwnerBrief;
    readonly source: 'cron' | 'on-demand';
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
    readonly source: 'cron' | 'on-demand';
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

    try {
      const cached = await readTodaysSnapshot(db, auth.tenantId);
      if (cached) {
        return c.json(
          {
            success: true,
            data: {
              brief: cached.brief,
              source: cached.source,
              generatedAt: cached.generatedAtIso,
              cached: true,
            },
          },
          200,
        );
      }

      const brief = await composeOwnerBrief(db, auth.tenantId);
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
