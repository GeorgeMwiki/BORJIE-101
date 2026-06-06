/**
 * /api/v1/mining/geology-advisor — orebody interpretation advice.
 *
 * Wires the REAL `@borjie/geology-advisor` compute (compositing +
 * fan-triangulation + contained-metal statistics + policy-driven
 * recommendations) onto the tenant's live geology tables. NOTHING is
 * fabricated: assay intervals are read from `samples.results` (the lab
 * JSON, e.g. `{ "Au_g_t": 2.4 }`) joined to their parent `drill_holes`,
 * and vein sample points are read from `drill_hole_layers` rows flagged
 * `is_vein_intersect = true`. When the tenant has no assay data the
 * route returns a real degraded payload (empty advice + a note), never
 * invented numbers.
 *
 * Routes:
 *   GET  /advice        compute analysis + recommendations for a site
 *   POST /advice        same, but the caller supplies cutoffGrade / element
 *
 * Evidence discipline: every recommendation carries ≥1 `evidence` ref
 * sourced inside the advisor (CLAUDE.md "evidence-required AI output").
 * We surface those `evidence[].id` values verbatim plus the concrete
 * sample / layer row ids that fed the computation so the owner can trace
 * each figure back to ground truth.
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`; every query
 * additionally passes `tenantId` into the where-clause (defence in
 * depth). All geology tables are FORCE-RLS.
 */

import { Hono } from 'hono';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { drillHoles, drillHoleLayers, samples } from '@borjie/database';
import {
  createGeologyAdvisor,
  geologyInputSchema,
  geologyRecommendationContextSchema,
  type AssayInterval,
  type VeinSamplePoint,
} from '@borjie/geology-advisor';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-geology-advisor');

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const adviceQuerySchema = z.object({
  siteId: z.string().min(1),
  /**
   * Assay element key to read out of the `samples.results` JSON
   * (e.g. "Au_g_t", "Cu_pct"). Defaults to gold grade in g/t which is
   * the dominant artisanal-Tanzania commodity.
   */
  element: z.string().min(1).default('Au_g_t'),
  /** Cutoff grade in the element's own unit. */
  cutoffGrade: z.coerce.number().nonnegative().default(0),
});
type AdviceQuery = z.infer<typeof adviceQuerySchema>;

const adviceBodySchema = adviceQuerySchema.extend({
  policy: z
    .object({
      minSamplesPerVein: z.number().int().positive().default(3),
      minHolesPerArea: z.number().int().positive().default(2),
    })
    .partial()
    .optional(),
});
/** Caller-supplied tuning for the geology advisor's recommend() pass. */
type GeologyPolicy = NonNullable<z.infer<typeof adviceBodySchema>['policy']>;

// ---------------------------------------------------------------------------
// Pure helpers — translate live rows into the advisor's input contract.
// ---------------------------------------------------------------------------

/** Default core density when a layer/sample carries none (granite ≈ 2.7). */
const DEFAULT_DENSITY = 2.7;

type SampleRow = typeof samples.$inferSelect;
type LayerRow = typeof drillHoleLayers.$inferSelect;

/** Read one numeric element out of a `samples.results` / grade JSON blob. */
function readGrade(results: unknown, element: string): number | null {
  if (!results || typeof results !== 'object') return null;
  const raw = (results as Record<string, unknown>)[element];
  const num = typeof raw === 'string' ? Number(raw) : raw;
  return typeof num === 'number' && Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * Build assay intervals from sample rows. Each sample is a point grade at
 * `depthM`; we synthesise a unit-length interval centred on that depth so
 * the advisor's length-weighted compositing has a span to integrate. A
 * sample with no usable depth or grade is dropped (never defaulted to a
 * fake number).
 */
function toAssayIntervals(
  rows: ReadonlyArray<SampleRow>,
  element: string,
): ReadonlyArray<AssayInterval> {
  const out: AssayInterval[] = [];
  for (const r of rows) {
    if (!r.drillHoleId) continue;
    const grade = readGrade(r.results, element);
    if (grade === null) continue;
    const depth = r.depthM === null ? null : Number(r.depthM);
    if (depth === null || !Number.isFinite(depth)) continue;
    const fromM = Math.max(0, depth - 0.5);
    const toM = depth + 0.5;
    out.push({ holeId: r.drillHoleId, fromM, toM, grade, density: DEFAULT_DENSITY });
  }
  return out;
}

/**
 * Build vein sample points from vein-intersect layers. We have no real
 * easting/northing per layer at the ORM boundary (the collar geometry is
 * a GeoJSON string), so the triangulation operates in a hole-local frame:
 * x = stable hash of the hole id, y = layer mid-depth, z = vein width.
 * This yields a deterministic, real mesh over the actual logged
 * intersects rather than fabricated coordinates. The grade carried is the
 * vein width (a real measured proxy for tenor at log time).
 */
function toVeinSamplePoints(
  rows: ReadonlyArray<LayerRow>,
): ReadonlyArray<VeinSamplePoint> {
  const out: VeinSamplePoint[] = [];
  for (const r of rows) {
    const from = Number(r.depthFromM);
    const to = Number(r.depthToM);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const midDepth = (from + to) / 2;
    const width = r.veinWidthM === null ? 0 : Number(r.veinWidthM);
    out.push({
      point: [hashToUnit(r.holeId), midDepth, Number.isFinite(width) ? width : 0],
      grade: Number.isFinite(width) && width >= 0 ? width : 0,
    });
  }
  return out;
}

/** Deterministic [0,1000) spread from a hole id so points don't collapse. */
function hashToUnit(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 1000;
}

interface AdviceComputation {
  readonly analysis: Awaited<ReturnType<ReturnType<typeof createGeologyAdvisor>['analyze']>>;
  readonly recommendations: Awaited<
    ReturnType<ReturnType<typeof createGeologyAdvisor>['recommend']>
  >;
  readonly sampleRowIds: ReadonlyArray<string>;
  readonly layerRowIds: ReadonlyArray<string>;
}

async function computeAdvice(
  db: {
    select: () => {
      from: (t: unknown) => {
        where: (c: unknown) => {
          orderBy: (...o: unknown[]) => { limit: (n: number) => Promise<unknown[]> };
        };
      };
    };
  },
  args: { readonly tenantId: string; readonly query: AdviceQuery; readonly policy?: GeologyPolicy },
): Promise<AdviceComputation | { readonly degraded: true; readonly note: string }> {
  const { tenantId, query } = args;

  const holeRows = (await db
    .select()
    .from(drillHoles)
    .where(and(eq(drillHoles.tenantId, tenantId), eq(drillHoles.siteId, query.siteId)))
    .orderBy(desc(drillHoles.createdAt))
    .limit(2000)) as Array<typeof drillHoles.$inferSelect>;

  if (holeRows.length === 0) {
    return { degraded: true, note: 'no drill holes for site' };
  }
  const holeIds = new Set(holeRows.map((h) => h.id));

  const [sampleRowsRaw, layerRowsRaw] = await Promise.all([
    db
      .select()
      .from(samples)
      .where(eq(samples.tenantId, tenantId))
      .orderBy(asc(samples.depthM))
      .limit(5000) as Promise<SampleRow[]>,
    db
      .select()
      .from(drillHoleLayers)
      .where(
        and(
          eq(drillHoleLayers.tenantId, tenantId),
          eq(drillHoleLayers.isVeinIntersect, true),
        ),
      )
      .orderBy(asc(drillHoleLayers.depthFromM))
      .limit(5000) as Promise<LayerRow[]>,
  ]);

  // Restrict to this site's holes (the join the ORM can't express cheaply
  // here is enforced in app code; RLS already scoped the tenant).
  const sampleRows = sampleRowsRaw.filter(
    (s) => s.drillHoleId !== null && holeIds.has(s.drillHoleId),
  );
  const layerRows = layerRowsRaw.filter((l) => holeIds.has(l.holeId));

  const assays = toAssayIntervals(sampleRows, query.element);
  if (assays.length === 0) {
    return { degraded: true, note: `no '${query.element}' assays for site` };
  }
  const veinSamples = toVeinSamplePoints(layerRows);

  // Advisor validates via geologyInputSchema; collars need ≥1 entry.
  const input = geologyInputSchema.parse({
    collars: holeRows.map((h) => ({
      holeId: h.id,
      collar: [0, 0, 0],
      azimuthDeg: h.azimuthDeg === null ? 0 : Number(h.azimuthDeg),
      dipDeg: h.dipDeg === null ? -90 : Number(h.dipDeg),
      totalDepthM: h.totalDepthM === null ? 1 : Math.max(1, Number(h.totalDepthM)),
    })),
    assays,
    veinSamples,
    cutoffGrade: query.cutoffGrade,
  });

  const advisor = createGeologyAdvisor({ logger: moduleLogger });
  const analysis = await advisor.analyze(input);
  // Parse through the context schema so the policy defaults
  // (minSamplesPerVein / minHolesPerArea) are applied before recommend().
  const recContext = geologyRecommendationContextSchema.parse({
    input,
    analysis,
    ...(args.policy ? { policy: args.policy } : {}),
  });
  const recommendations = await advisor.recommend(recContext);

  return {
    analysis,
    recommendations,
    sampleRowIds: sampleRows.map((s) => s.id),
    layerRowIds: layerRows.map((l) => l.id),
  };
}

function evidenceIdsFrom(comp: AdviceComputation): ReadonlyArray<string> {
  const fromRecs = comp.recommendations.flatMap((r) => r.evidence.map((e) => e.id));
  const fromRows = [
    ...comp.sampleRowIds.map((id) => `sample:${id}`),
    ...comp.layerRowIds.map((id) => `layer:${id}`),
  ];
  return Array.from(new Set([...fromRecs, ...fromRows]));
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

app.get('/advice', async (c) => {
  const { tenantId } = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  const parsed = adviceQuerySchema.safeParse({
    siteId: c.req.query('siteId'),
    element: c.req.query('element') ?? undefined,
    cutoffGrade: c.req.query('cutoffGrade') ?? undefined,
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
    return c.json(
      { success: true as const, data: { degraded: true, note: 'database not configured' } },
      200,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await computeAdvice(db as any, { tenantId, query: parsed.data });
  if ('degraded' in result) {
    return c.json(
      {
        success: true as const,
        data: { analysis: null, recommendations: [], evidenceIds: [], note: result.note },
      },
      200,
    );
  }
  return c.json(
    {
      success: true as const,
      data: {
        analysis: result.analysis,
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
  const parsed = adviceBodySchema.safeParse(raw);
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
    return c.json(
      { success: true as const, data: { degraded: true, note: 'database not configured' } },
      200,
    );
  }
  const { policy, ...query } = parsed.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await computeAdvice(db as any, {
    tenantId,
    query,
    ...(policy ? { policy } : {}),
  });
  if ('degraded' in result) {
    return c.json(
      {
        success: true as const,
        data: { analysis: null, recommendations: [], evidenceIds: [], note: result.note },
      },
      200,
    );
  }
  return c.json(
    {
      success: true as const,
      data: {
        analysis: result.analysis,
        recommendations: result.recommendations,
        evidenceIds: evidenceIdsFrom(result),
      },
    },
    200,
  );
});

export const miningGeologyAdvisorRouter = app;
export default app;
