/**
 * /api/v1/md — MD-Intelligence HTTP surface (Wave MD-INTELLIGENCE).
 *
 * Backs the four "Managing Director" brain super-power tools defined in
 * `composition/brain-tools/md-intelligence-tools.ts`. Each tool POSTs to a
 * route here; previously these tools 404'd because no router existed even
 * though the underlying pure-functional services were fully implemented.
 *
 *   POST /md/correlations       → correlation-engine.correlate()
 *   POST /md/causation/trace    → causation-tracer.trace()
 *   POST /md/baselines/compare  → comparison-framework.compare()
 *   POST /md/insights/emit      → insight-emitter.emit()
 *
 * Each handler validates its body with zod, maps the wire payload onto the
 * service's input shape, and returns exactly the shape the tool's output
 * schema expects (the service result shapes already line up field-for-field).
 *
 * Grounding discipline (CLAUDE.md hard rule — no fabricated data):
 *   - `correlate` / `trace` read from the frozen signal graph. The live
 *     "is this node lit on the tenant?" probe has no data source over HTTP
 *     yet, so we use each service's documented default probe (treat nodes as
 *     present) — this surfaces REAL graph edges, never invented ones.
 *   - `compare` is called with NO baseline readers, so every baseline comes
 *     back `null` with `note: 'awaiting seed'` — the service's designed
 *     honest-gap path (identical to the tool's own no-client fallback). The
 *     Drizzle-backed readers over peer_cohort_aggregates / external_benchmarks
 *     (migration 0095) are a follow-up wiring; until then we render an honest
 *     gap rather than a fabricated comparison.
 *   - `emit` requires the resolved `fullPicture` to ground every insight. The
 *     tool does not carry that bundle across the HTTP boundary, so we pass an
 *     empty picture and the emitter correctly returns zero insights — it
 *     NEVER fabricates an ungrounded insight.
 *
 * Persona binding: the tools themselves are owner-strategist (T1) only; this
 * router applies the standard `authMiddleware` like every other authenticated
 * `/api/v1/*` router (tenant scope flows from the JWT).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../../middleware/hono-auth';
import {
  correlate,
  trace,
  compare,
  emit,
} from '../../services/md-intelligence';
import type { DomainId } from '../../services/domain-depth/types';

// The 14 owner-os domains the signal graph + domain-depth catalog cover.
// Kept in lock-step with `services/md-intelligence/.../domain-depth/types.ts`.
const DOMAIN_IDS = [
  'compliance',
  'finance',
  'operations',
  'hr',
  'marketing',
  'risk',
  'treasury',
  'geology',
  'marketplace',
  'licences',
  'holdings',
  'subsidiaries',
  'succession',
  'asset-register',
] as const satisfies ReadonlyArray<DomainId>;

const DomainEnum = z.enum(DOMAIN_IDS);

/** Resolve the authoritative tenant: JWT auth context first, body as fallback. */
function resolveTenantId(authTenantId: string | undefined, bodyTenantId: string): string {
  return authTenantId && authTenantId.length > 0 ? authTenantId : bodyTenantId;
}

export const mdRouter = new Hono();

mdRouter.use('*', authMiddleware);

// ─────────────────────────────────────────────────────────────────────
// POST /md/correlations
// ─────────────────────────────────────────────────────────────────────

const CorrelationsBody = z.object({
  tenantId: z.string().min(1),
  domain: DomainEnum,
  scopeNodeId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(10).default(3),
});

mdRouter.post('/correlations', zValidator('json', CorrelationsBody), async (c) => {
  const body = c.req.valid('json');
  const auth = c.get('auth') as { tenantId?: string } | undefined;
  const tenantId = resolveTenantId(auth?.tenantId, body.tenantId);

  const result = await correlate({
    domain: body.domain,
    scope: { tenantId, ...(body.scopeNodeId ? { siteId: body.scopeNodeId } : {}) },
    limit: body.limit,
  });

  return c.json({
    domain: result.domain,
    probedNodes: result.probedNodes,
    touches: result.touches,
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /md/causation/trace
// ─────────────────────────────────────────────────────────────────────

const TraceBody = z.object({
  tenantId: z.string().min(1),
  symptom: z.string().min(1).max(120),
  scopeNodeId: z.string().uuid().optional(),
  maxDepth: z.number().int().positive().max(6).default(3),
  limit: z.number().int().positive().max(10).default(3),
});

mdRouter.post('/causation/trace', zValidator('json', TraceBody), async (c) => {
  const body = c.req.valid('json');
  const auth = c.get('auth') as { tenantId?: string } | undefined;
  const tenantId = resolveTenantId(auth?.tenantId, body.tenantId);

  const result = await trace({
    symptom: body.symptom,
    scope: { tenantId, ...(body.scopeNodeId ? { siteId: body.scopeNodeId } : {}) },
    maxDepth: body.maxDepth,
    limit: body.limit,
  });

  return c.json({
    symptomNode: result.symptomNode,
    maxDepth: result.maxDepth,
    chains: result.chains,
  });
});

// ─────────────────────────────────────────────────────────────────────
// POST /md/baselines/compare
// ─────────────────────────────────────────────────────────────────────

const CompareBody = z.object({
  tenantId: z.string().min(1),
  metricId: z.string().min(1).max(120),
  tenantValue: z.number(),
  cohortKey: z.string().min(1).max(120).optional(),
});

mdRouter.post('/baselines/compare', zValidator('json', CompareBody), async (c) => {
  const body = c.req.valid('json');
  const auth = c.get('auth') as { tenantId?: string } | undefined;
  const tenantId = resolveTenantId(auth?.tenantId, body.tenantId);

  // No baseline readers wired yet → the framework returns every baseline as
  // null with `note: 'awaiting seed'` (its designed honest-gap path). The
  // Drizzle readers over peer_cohort_aggregates / external_benchmarks land in
  // a follow-up wiring.
  const result = await compare({
    metricId: body.metricId,
    tenant: body.tenantValue,
    scope: {
      tenantId,
      metricId: body.metricId,
      ...(body.cohortKey ? { cohortKey: body.cohortKey } : {}),
    },
    readers: {},
  });

  return c.json(result);
});

// ─────────────────────────────────────────────────────────────────────
// POST /md/insights/emit
// ─────────────────────────────────────────────────────────────────────

const EmitBody = z.object({
  tenantId: z.string().min(1),
  domain: DomainEnum,
  scopeNodeId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(5).default(3),
});

mdRouter.post('/insights/emit', zValidator('json', EmitBody), async (c) => {
  const body = c.req.valid('json');

  // The emitter grounds every insight in the resolved `fullPicture`. That
  // bundle is not carried across the tool's HTTP boundary, so we pass an
  // empty picture: the emitter then returns zero insights rather than
  // fabricating an ungrounded one (its hard grounding rule). When the
  // domain-depth resolvers are wired server-side, pass the resolved picture
  // (+ correlate()/compare() results) here to surface real insights.
  const result = emit({
    domain: body.domain,
    fullPicture: [],
    limit: body.limit,
  });

  return c.json({
    groundedDataPoints: result.groundedDataPoints,
    rejectedForUngrounded: result.rejectedForUngrounded,
    insights: result.insights,
  });
});

export default mdRouter;
