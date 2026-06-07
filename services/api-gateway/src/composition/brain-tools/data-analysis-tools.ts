/**
 * Data-analysis brain tools — wires `@borjie/data-analysis` (reference-
 * validated statistical primitives + mining wrappers) into Mr. Mwikila's
 * persona-aware tool catalog.
 *
 *   - `mwikila.analytics.site_performance`
 *        Computes a REAL descriptive summary + 95% bootstrap confidence
 *        interval on a site's ore-tonnes throughput, over the tenant's
 *        live `production_tonnage_events` rows (QA-passed events only).
 *        The compute is `sitePerformanceStats` from @borjie/data-analysis
 *        (Kahan-summed mean, percentile IQR, 2000-resample bootstrap CI) —
 *        nothing is fabricated; when the site has no QA-passed tonnage the
 *        tool returns a typed 'no_data' result, never invented numbers.
 *        LOW stakes, READ-only, persona-gated to owner / admin / manager.
 *
 * EVIDENCE (CLAUDE.md "evidence-required AI output"): every result carries
 * the concrete `tonnage_event:<id>` row ids that fed the statistics PLUS the
 * tenant's jurisdiction provenance (country / currency / timezone / regulator
 * ids) read from the composition-root jurisdiction registry — so the figure
 * is traceable to ground truth and to the legal frame it was computed in. The
 * currency code is READ from the registry, never hard-coded (currency-neutral
 * hard rule).
 *
 * Tenant isolation: the handler resolves `ctx.tenantId` and runs its read
 * inside `withTenantContext(...)` — a short pinned transaction that binds the
 * canonical `app.current_tenant_id` GUC — so every row is RLS-filtered even
 * though brain tools run outside the request `databaseMiddleware`.
 *
 * Composition root: register through brain-tools/index.ts so the persona-
 * runtime ToolDispatcher discovers it at boot (see integration notes).
 */

import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTenantContext } from '@borjie/database';
import { sitePerformanceStats } from '@borjie/data-analysis';

import { getDb } from '../db-client.js';
import { getJurisdictionContext } from '../jurisdiction-registry.js';
import type { PersonaToolDescriptor } from './types.js';

const OWNER_ADMIN_MANAGER: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist' | 'T3_module_manager'
> = ['T1_owner_strategist', 'T2_admin_strategist', 'T3_module_manager'];

// ─────────────────────────────────────────────────────────────────────
// mwikila.analytics.site_performance
// ─────────────────────────────────────────────────────────────────────

const SitePerformanceInput = z.object({
  /** The site whose throughput to analyse. */
  siteId: z.string().min(1).max(120),
  /** Lookback window in days (bounds the event scan). */
  windowDays: z.number().int().positive().max(365).default(90),
  /**
   * Optional deterministic seed for the bootstrap resampler so a result can
   * be reproduced exactly in a replay / audit.
   */
  seed: z.number().int().optional(),
});

const DescriptiveStatsSchema = z.object({
  n: z.number(),
  mean: z.number(),
  median: z.number(),
  variance: z.number(),
  stddev: z.number(),
  min: z.number(),
  max: z.number(),
  range: z.number(),
  q1: z.number(),
  q3: z.number(),
  iqr: z.number(),
  skewness: z.number(),
  kurtosis: z.number(),
});

const JurisdictionContextSchema = z.object({
  jurisdictionId: z.string(),
  countryName: z.string(),
  currencyCode: z.string(),
  timezone: z.string(),
  regulatorIds: z.array(z.string()),
});

const SitePerformanceOutput = z.object({
  siteId: z.string(),
  status: z.enum(['ok', 'no_data', 'db_unavailable']),
  nDays: z.number(),
  summary: DescriptiveStatsSchema.nullable(),
  meanCi95: z
    .object({ low: z.number(), high: z.number() })
    .nullable(),
  /** Concrete row ids that fed the statistics (CLAUDE.md evidence-required). */
  evidenceIds: z.array(z.string()),
  /** Legal frame the figure was computed in — null if jurisdiction unseeded. */
  jurisdiction: JurisdictionContextSchema.nullable(),
  note: z.string().optional(),
});

interface TonnageRow {
  readonly id: string;
  readonly ore_tonnes: string | number | null;
}

function toTonnes(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function rowsOf(raw: unknown): ReadonlyArray<TonnageRow> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<TonnageRow>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<TonnageRow>;
  }
  return [];
}

export const analyticsSitePerformanceTool: PersonaToolDescriptor<
  typeof SitePerformanceInput,
  typeof SitePerformanceOutput
> = {
  id: 'mwikila.analytics.site_performance',
  name: 'Analytics — site throughput performance',
  description:
    "Compute a statistically-grounded performance summary for ONE site's ore " +
    'throughput: descriptive stats (mean / median / spread / skew) plus a 95% ' +
    'bootstrap confidence interval on the mean ore-tonnes per QA-passed ' +
    'production event, over a lookback window. Use when the owner asks "how is ' +
    'site X performing", "what is our average tonnage at Y", "is throughput ' +
    'stable", or any equivalent production-statistics question. Returns the ' +
    'concrete row ids it used as evidence + the jurisdiction frame. READ-only, ' +
    'LOW stakes, persona-gated to owner / admin / manager. Backed by the ' +
    'reference-validated @borjie/data-analysis primitives — never estimates.',
  personaSlugs: OWNER_ADMIN_MANAGER,
  inputSchema: SitePerformanceInput,
  outputSchema: SitePerformanceOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    // Jurisdiction provenance is static law — resolve it regardless of DB
    // state so even a degraded result carries its legal frame. TZ is the
    // launch beachhead; the registry returns undefined for unseeded ids.
    const jx = getJurisdictionContext('tz');
    const jurisdiction = jx
      ? {
          jurisdictionId: jx.jurisdictionId,
          countryName: jx.countryName,
          currencyCode: jx.currencyCode,
          timezone: jx.timezone,
          regulatorIds: [...jx.regulatorIds],
        }
      : null;

    const db = getDb();
    if (!db) {
      return {
        siteId: input.siteId,
        status: 'db_unavailable' as const,
        nDays: 0,
        summary: null,
        meanCi95: null,
        evidenceIds: [],
        jurisdiction,
        note: 'database not configured',
      };
    }

    // Read QA-passed ore-tonnes events for the site inside a tenant-pinned
    // transaction so RLS fires (brain tools run outside databaseMiddleware).
    // The `as unknown as` casts sidestep the TS2709 namespace-vs-type drift
    // on `@borjie/database`'s `DatabaseClient` (same idiom as
    // composition/proactive/proactive-wiring.ts).
    const rows = await withTenantContext(
      db as unknown as Parameters<typeof withTenantContext>[0],
      ctx.tenantId,
      async (tx) => {
        const txDb = tx as unknown as { execute(q: unknown): Promise<unknown> };
        const raw = await txDb.execute(
          sql`
            SELECT id, ore_tonnes
              FROM production_tonnage_events
             WHERE tenant_id = ${ctx.tenantId}::uuid
               AND site_id   = ${input.siteId}::uuid
               AND qa_status = 'passed'
               AND captured_at >= now() - make_interval(days => ${input.windowDays})
             ORDER BY captured_at ASC
             LIMIT 10000
          `,
        );
        return rowsOf(raw);
      },
    );

    const throughput: number[] = [];
    const evidenceIds: string[] = [];
    for (const r of rows) {
      const t = toTonnes(r.ore_tonnes);
      if (t === null) continue;
      throughput.push(t);
      evidenceIds.push(`tonnage_event:${r.id}`);
    }

    if (throughput.length === 0) {
      return {
        siteId: input.siteId,
        status: 'no_data' as const,
        nDays: 0,
        summary: null,
        meanCi95: null,
        evidenceIds: [],
        jurisdiction,
        note: 'no QA-passed tonnage events for site in window',
      };
    }

    const perf = sitePerformanceStats(input.siteId, throughput, {
      ...(input.seed !== undefined ? { seed: input.seed } : {}),
    });

    return {
      siteId: perf.siteId,
      status: 'ok' as const,
      nDays: perf.nDays,
      summary: perf.summary,
      meanCi95: perf.meanCi95,
      evidenceIds,
      jurisdiction,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalogue export
// ─────────────────────────────────────────────────────────────────────

export const DATA_ANALYSIS_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  analyticsSitePerformanceTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
