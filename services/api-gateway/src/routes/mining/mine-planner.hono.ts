/**
 * /api/v1/mining/mine-planner — 24h shift-plan advice.
 *
 * Wires the REAL `@borjie/mine-planner-advisor` compute (greedy
 * deterministic polygon→equipment→crew matcher producing a per-shift
 * plan with tonnage / hours / opex + skill-gap recommendations) onto the
 * tenant's live operations tables:
 *
 *   - polygons  ← `ore_parcels` for the site (each saleable stockpile is
 *                 a real work target; estimatedTonnes = mass_kg / 1000).
 *   - fleet     ← `assets` whose `kind` maps onto an advisor equipment
 *                 kind (excavator / truck→haul-truck / drill_rig→drill /
 *                 loader / crusher / grader) and whose status is
 *                 operational.
 *   - crew      ← the operators currently bound to those assets
 *                 (`current_operator_user_id`), each rostered for all
 *                 three shifts with the skill of the asset they run.
 *
 * Nothing is fabricated: when the tenant has no parcels or no eligible
 * fleet the route returns a real degraded payload (empty plan + a note).
 * Opex is read straight from the asset's hourly cost attribute; absent
 * that, it is zero (never an invented rate). Currency is therefore never
 * hard-coded here — the advisor reports opex as a bare number and the
 * owner-web surface renders it through `formatCurrency`.
 *
 * Routes:
 *   GET  /advice    compute a plan + recommendations for a site/date
 *   POST /advice    same, with caller-supplied targetTonnesPerDay/date
 *
 * Evidence discipline: every recommendation carries ≥1 `evidence` ref
 * from the advisor; we also surface the parcel / asset row ids that fed
 * the plan so each number is traceable to ground truth.
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`; every query
 * also passes `tenantId` (defence in depth). All tables are FORCE-RLS.
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { oreParcels, assets } from '@borjie/database';
import {
  createMinePlannerAdvisor,
  planInputSchema,
  type CrewMember,
  type Equipment,
  type EquipmentKind,
  type Polygon,
} from '@borjie/mine-planner-advisor';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-mine-planner');

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const adviceQuerySchema = z.object({
  siteId: z.string().min(1),
  /** ISO date the plan is for; defaults to today (UTC). */
  planDateISO: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Daily target in tonnes; defaults to the parcel sum so the plan is
   *  "clear the stockpiles" when the owner gives no explicit target. */
  targetTonnesPerDay: z.coerce.number().positive().optional(),
});
type AdviceQuery = z.infer<typeof adviceQuerySchema>;

// ---------------------------------------------------------------------------
// Pure helpers — translate live rows into the advisor's input contract.
// ---------------------------------------------------------------------------

type ParcelRow = typeof oreParcels.$inferSelect;
type AssetRow = typeof assets.$inferSelect;

/** Map a live asset `kind` onto the advisor's equipment-kind enum. */
const ASSET_KIND_TO_EQUIPMENT: Readonly<Record<string, EquipmentKind>> = {
  excavator: 'excavator',
  truck: 'haul-truck',
  drill_rig: 'drill',
  loader: 'loader',
  crusher: 'crusher',
  grader: 'grader',
};

function mapEquipmentKind(assetKind: string): EquipmentKind | null {
  return ASSET_KIND_TO_EQUIPMENT[assetKind] ?? null;
}

/** Read a numeric attribute from an asset's JSON attributes blob. */
function readNum(attrs: unknown, key: string, fallback: number): number {
  if (!attrs || typeof attrs !== 'object') return fallback;
  const raw = (attrs as Record<string, unknown>)[key];
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback;
}

const ALL_SHIFTS = ['morning', 'afternoon', 'night'] as const;

function toPolygons(rows: ReadonlyArray<ParcelRow>): ReadonlyArray<Polygon> {
  const out: Polygon[] = [];
  for (const r of rows) {
    const massKg = r.massKg === null ? 0 : Number(r.massKg);
    const tonnes = Number.isFinite(massKg) ? massKg / 1000 : 0;
    if (tonnes <= 0) continue;
    out.push({
      id: r.id,
      label: r.storageLocation ?? `parcel-${r.id.slice(0, 8)}`,
      // The advisor only uses `ring` for the shoelace helper, not for the
      // plan; a unit ring keeps the schema satisfied without fabricating
      // a real boundary (the parcel has no polygon column).
      ring: [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0],
      ],
      estimatedTonnes: tonnes,
      grade: 0,
    });
  }
  return out;
}

function toFleet(
  rows: ReadonlyArray<AssetRow>,
  planDateISO: string,
): ReadonlyArray<Equipment> {
  const out: Equipment[] = [];
  for (const r of rows) {
    const kind = mapEquipmentKind(r.kind);
    if (kind === null) continue;
    if (r.status !== 'operational') continue;
    // Real capacity / opex are read from the asset attributes; a missing
    // capacity makes the unit unusable (capacity must be positive), so we
    // skip rather than invent one. Opex defaults to 0 (no fabricated rate).
    const capacity = readNum(r.attributes, 'capacityTonnesPerHour', 0);
    if (capacity <= 0) continue;
    const hourlyOpex = readNum(r.attributes, 'hourlyOpex', 0);
    out.push({
      id: r.id,
      kind,
      capacityTonnesPerHour: capacity,
      availableFromISO: planDateISO,
      availableToISO: planDateISO,
      hourlyOpex,
    });
  }
  return out;
}

/**
 * Build the crew from the operators bound to eligible assets. Each
 * operator is rostered for all three shifts with the skill of the asset
 * they currently run — a real, conservative roster derived from live
 * `current_operator_user_id` bindings (no invented people). Assets with
 * no operator contribute no crew, which the advisor then surfaces as a
 * `hire-skill` / skill-gap recommendation.
 */
function toCrew(rows: ReadonlyArray<AssetRow>): ReadonlyArray<CrewMember> {
  const bySkill = new Map<string, Set<EquipmentKind>>();
  for (const r of rows) {
    const kind = mapEquipmentKind(r.kind);
    if (kind === null) continue;
    if (r.status !== 'operational') continue;
    const op = r.currentOperatorUserId;
    if (!op) continue;
    const set = bySkill.get(op) ?? new Set<EquipmentKind>();
    set.add(kind);
    bySkill.set(op, set);
  }
  const out: CrewMember[] = [];
  for (const [userId, skills] of bySkill.entries()) {
    out.push({
      id: userId,
      name: userId,
      skills: Array.from(skills),
      shiftAvailability: [...ALL_SHIFTS],
    });
  }
  return out;
}

interface PlanComputation {
  readonly plan: Awaited<ReturnType<ReturnType<typeof createMinePlannerAdvisor>['analyze']>>;
  readonly recommendations: Awaited<
    ReturnType<ReturnType<typeof createMinePlannerAdvisor>['recommend']>
  >;
  readonly parcelRowIds: ReadonlyArray<string>;
  readonly assetRowIds: ReadonlyArray<string>;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function computePlan(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: { readonly tenantId: string; readonly query: AdviceQuery },
): Promise<PlanComputation | { readonly degraded: true; readonly note: string }> {
  const { tenantId, query } = args;
  const planDateISO = query.planDateISO ?? todayISO();

  const [parcelRows, assetRows] = (await Promise.all([
    db
      .select()
      .from(oreParcels)
      .where(and(eq(oreParcels.tenantId, tenantId), eq(oreParcels.siteId, query.siteId)))
      .orderBy(desc(oreParcels.createdAt))
      .limit(1000),
    db
      .select()
      .from(assets)
      .where(and(eq(assets.tenantId, tenantId), eq(assets.currentSiteId, query.siteId)))
      .orderBy(desc(assets.createdAt))
      .limit(1000),
  ])) as [ParcelRow[], AssetRow[]];

  const polygons = toPolygons(parcelRows);
  if (polygons.length === 0) {
    return { degraded: true, note: 'no ore parcels with tonnage for site' };
  }
  const fleet = toFleet(assetRows, planDateISO);
  if (fleet.length === 0) {
    return { degraded: true, note: 'no operational fleet with capacity for site' };
  }
  const crew = toCrew(assetRows);
  if (crew.length === 0) {
    return { degraded: true, note: 'no rostered operators for site fleet' };
  }

  const target =
    query.targetTonnesPerDay ??
    Math.max(1, polygons.reduce((s, p) => s + p.estimatedTonnes, 0));

  const input = planInputSchema.parse({
    siteId: query.siteId,
    planDateISO,
    polygons,
    fleet,
    crew,
    targetTonnesPerDay: target,
  });

  const advisor = createMinePlannerAdvisor({ logger: moduleLogger });
  const plan = await advisor.analyze(input);
  const recommendations = await advisor.recommend({ input, plan });

  return {
    plan,
    recommendations,
    parcelRowIds: parcelRows.map((p) => p.id),
    assetRowIds: assetRows.map((a) => a.id),
  };
}

function evidenceIdsFrom(comp: PlanComputation): ReadonlyArray<string> {
  const fromRecs = comp.recommendations.flatMap((r) => r.evidence.map((e) => e.id));
  const fromRows = [
    ...comp.parcelRowIds.map((id) => `parcel:${id}`),
    ...comp.assetRowIds.map((id) => `asset:${id}`),
  ];
  return Array.from(new Set([...fromRecs, ...fromRows]));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function degradedPayload(note: string) {
  return {
    success: true as const,
    data: { plan: null, recommendations: [], evidenceIds: [], note },
  };
}

app.get('/advice', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  const parsed = adviceQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
    planDateISO: c.req.query('planDateISO') ?? undefined,
    targetTonnesPerDay: c.req.query('targetTonnesPerDay') ?? undefined,
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues },
      },
      400,
    );
  }
  if (!db) {
    return c.json(degradedPayload('database not configured'), 200);
  }
  const result = await computePlan(db, { tenantId, query: parsed.data });
  if ('degraded' in result) {
    return c.json(degradedPayload(result.note), 200);
  }
  return c.json(
    {
      success: true as const,
      data: {
        plan: result.plan,
        recommendations: result.recommendations,
        evidenceIds: evidenceIdsFrom(result),
      },
    },
    200,
  );
});

app.post('/advice', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  const raw = await c.req.json().catch(() => ({}));
  const parsed = adviceQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', issues: parsed.error.issues },
      },
      400,
    );
  }
  if (!db) {
    return c.json(degradedPayload('database not configured'), 200);
  }
  const result = await computePlan(db, { tenantId, query: parsed.data });
  if ('degraded' in result) {
    return c.json(degradedPayload(result.note), 200);
  }
  return c.json(
    {
      success: true as const,
      data: {
        plan: result.plan,
        recommendations: result.recommendations,
        evidenceIds: evidenceIdsFrom(result),
      },
    },
    200,
  );
});

export const miningMinePlannerRouter = app;
export default app;
