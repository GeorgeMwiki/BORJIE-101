// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union; see other routers.
/**
 * AI-Native router — Agent PhG.
 *
 * Mounted at `/api/v1/ai-native`. Every endpoint is tenant-scoped via the
 * shared `authMiddleware`.
 *
 *   POST /ai-native/sentiment/scan
 *        One-shot classifier for an ad-hoc message. Returns a stored signal.
 *
 *   POST /ai-native/inspections/:id/analyze
 *        Multimodal vision call over an inspection's media.
 *
 *   POST /ai-native/query/nl
 *        Natural-language → typed AST → SQL → rows + NL summary.
 *
 *   POST /ai-native/simulate/policy
 *        Monte-Carlo "what-if" simulation on a policy change.
 *
 *   GET  /ai-native/predictions/tenant/:customerId
 *        Recent predictions for a tenant (30/60/90 horizons).
 *
 *   GET  /ai-native/signals?since=...
 *        Recent sentiment signals across the portfolio (tenant-scoped).
 *
 * Every endpoint returns a structured envelope:
 *   success: { success: true, data }
 *   failure: { success: false, error: { code, message } }
 *
 * When a capability's wiring is missing (no LLM, no ports, etc.) the
 * endpoint returns 503 with a clear config-missing reason — callers
 * never see a crash, only a degraded code.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/hono-auth';
import { safeInternalError } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
type AnyCtx = any;

function getServices(c: AnyCtx): Record<string, unknown> {
  return c.get('services') ?? {};
}

function unavailable(c: AnyCtx, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, 503);
}

function badRequest(c: AnyCtx, message: string) {
  return c.json({ success: false, error: { code: 'BAD_REQUEST', message } }, 400);
}

function internalError(c: AnyCtx, err: unknown) {
  return safeInternalError(c, err, {
    code: 'INTERNAL_ERROR',
    fallback: 'Internal server error',
  });
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const SentimentScanSchema = z.object({
  sourceType: z
    .enum(['message', 'complaint', 'feedback', 'inspection_note', 'case_note', 'other'])
    .default('message'),
  sourceId: z.string().min(1),
  text: z.string().min(1).max(10_000),
  customerId: z.string().min(1).nullable().optional(),
  languageHint: z.string().min(1).max(10).nullable().optional(),
});

const MediaSchema = z.object({
  kind: z.enum(['image', 'video', 'audio']),
  url: z.string().min(1).max(4096),
  mediaId: z.string().min(1).max(200).optional(),
});

const InspectionAnalyzeSchema = z.object({
  media: z.array(MediaSchema).min(1).max(30),
  contextNote: z.string().max(2000).optional(),
  currencyCode: z.string().min(3).max(3).optional(),
});

const NLQuerySchema = z.object({
  question: z.string().min(1).max(2000),
});

const PolicyChangeSchema = z.object({
  kind: z.enum([
    'rent_increase_pct',
    'rent_decrease_pct',
    'fee_add',
    'fee_remove',
    'policy_custom',
  ]),
  magnitude: z.number().finite().optional(),
  description: z.string().min(1).max(1000),
});

const PolicyScopeSchema = z.object({
  propertyIds: z.array(z.string().min(1)).optional(),
  countryCode: z.string().min(2).max(3).optional(),
  region: z.string().max(200).optional(),
  tags: z.array(z.string().min(1)).optional(),
});

const LeaseSimSchema = z.object({
  leaseId: z.string().min(1),
  customerId: z.string().min(1),
  currencyCode: z.string().min(3).max(3),
  currentRentMinor: z.number().int().nonnegative(),
  remainingMonths: z.number().int().nonnegative(),
  baselineRenewalProb: z.number().min(0).max(1),
  churnSensitivityToRent: z.number().min(0).max(5),
});

const SimulatePolicySchema = z.object({
  change: PolicyChangeSchema,
  scope: PolicyScopeSchema,
  leases: z.array(LeaseSimSchema).optional(),
  paths: z.number().int().positive().max(10_000).optional(),
  monthlyDiscountRate: z.number().finite().optional(),
  seed: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = new Hono();

router.use('*', authMiddleware);

// --- POST /ai-native/sentiment/scan -----------------------------------------
router.post(
  '/sentiment/scan',
  zValidator('json', SentimentScanSchema),
  withSecurityEvents({ action: 'ai-native.create', resource: 'ai-native', severity: 'info' }, async (c) => {
    try {
      const services = getServices(c);
      const monitor = (services as any).sentimentMonitor;
      if (!monitor) {
        return unavailable(
          c,
          'SENTIMENT_MONITOR_UNAVAILABLE',
          'sentimentMonitor not wired in gateway context',
        );
      }
      const auth = c.get('auth');
      const body = c.req.valid('json');
      const signal = await monitor.ingest({
        tenantId: auth.tenantId,
        customerId: body.customerId ?? null,
        sourceType: body.sourceType,
        sourceId: body.sourceId,
        text: body.text,
        languageHint: body.languageHint ?? null,
      });
      return c.json({ success: true, data: signal }, 201);
    } catch (err) {
      return internalError(c, err);
    }
  }),
);

// --- GET /ai-native/signals?since=... ---------------------------------------
router.get('/signals', async (c) => {
  try {
    const services = getServices(c);
    const monitor = (services as any).sentimentMonitor;
    if (!monitor) {
      return unavailable(
        c,
        'SENTIMENT_MONITOR_UNAVAILABLE',
        'sentimentMonitor not wired in gateway context',
      );
    }
    const auth = c.get('auth');
    const since = c.req.query('since') ?? undefined;
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Math.max(1, Math.min(500, Number(limitRaw))) : 100;
    const customerId = c.req.query('customerId') ?? undefined;
    const rows = await monitor.listRecent(auth.tenantId, {
      since,
      limit,
      customerId: customerId ?? null,
    });
    return c.json({ success: true, data: rows });
  } catch (err) {
    return internalError(c, err);
  }
});

// --- POST /ai-native/inspections/:id/analyze --------------------------------
router.post(
  '/inspections/:id/analyze',
  zValidator('json', InspectionAnalyzeSchema),
  withSecurityEvents({ action: 'ai-native.create', resource: 'ai-native', severity: 'info' }, async (c) => {
    try {
      const services = getServices(c);
      const multimodal = (services as any).multimodalInspection;
      if (!multimodal) {
        return unavailable(
          c,
          'MULTIMODAL_INSPECTION_UNAVAILABLE',
          'multimodalInspection not wired (set VISION_API_KEY)',
        );
      }
      const auth = c.get('auth');
      const inspectionId = c.req.param('id');
      if (!inspectionId) return badRequest(c, 'inspection id is required');
      const body = c.req.valid('json');
      const findings = await multimodal.analyze({
        tenantId: auth.tenantId,
        inspectionId,
        media: body.media,
        contextNote: body.contextNote,
        currencyCode: body.currencyCode,
      });
      return c.json({ success: true, data: findings }, 201);
    } catch (err) {
      return internalError(c, err);
    }
  }),
);

// --- POST /ai-native/query/nl -----------------------------------------------
router.post(
  '/query/nl',
  zValidator('json', NLQuerySchema),
  withSecurityEvents({ action: 'ai-native.create', resource: 'ai-native', severity: 'info' }, async (c) => {
    try {
      const services = getServices(c);
      const nlq = (services as any).naturalLanguageQuery;
      if (!nlq) {
        return unavailable(
          c,
          'NL_QUERY_UNAVAILABLE',
          'naturalLanguageQuery not wired (requires LLM port)',
        );
      }
      const auth = c.get('auth');
      const body = c.req.valid('json');
      const result = await nlq.ask({ tenantId: auth.tenantId, question: body.question });
      return c.json({ success: true, data: result });
    } catch (err) {
      // Validation errors from the AST compiler are surfaced as 400
      if (err instanceof Error && (err as any).code === 'INVALID_QUERY_AST') {
        return badRequest(c, err.message);
      }
      return internalError(c, err);
    }
  }),
);

// --- POST /ai-native/simulate/policy ----------------------------------------
router.post(
  '/simulate/policy',
  zValidator('json', SimulatePolicySchema),
  withSecurityEvents({ action: 'ai-native.create', resource: 'ai-native', severity: 'info' }, async (c) => {
    try {
      const services = getServices(c);
      const simulator = (services as any).policySimulator;
      if (!simulator) {
        return unavailable(
          c,
          'POLICY_SIMULATOR_UNAVAILABLE',
          'policySimulator not wired in gateway context',
        );
      }
      const auth = c.get('auth');
      const body = c.req.valid('json');
      const result = await simulator.simulate({
        tenantId: auth.tenantId,
        change: body.change,
        scope: body.scope,
        leases: body.leases,
        paths: body.paths,
        monthlyDiscountRate: body.monthlyDiscountRate,
        seed: body.seed,
      });
      return c.json({ success: true, data: result });
    } catch (err) {
      return internalError(c, err);
    }
  }),
);

// --- GET /ai-native/predictions/tenant/:customerId --------------------------
router.get('/predictions/tenant/:customerId', async (c) => {
  try {
    const services = getServices(c);
    const predictive = (services as any).predictiveInterventions;
    if (!predictive) {
      return unavailable(
        c,
        'PREDICTIVE_INTERVENTIONS_UNAVAILABLE',
        'predictiveInterventions not wired in gateway context',
      );
    }
    const auth = c.get('auth');
    const customerId = c.req.param('customerId');
    if (!customerId) return badRequest(c, 'customerId required');
    const rows = await predictive.listRecent(auth.tenantId, customerId);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return internalError(c, err);
  }
});

// =============================================================================
// Agent PhL capabilities: dynamic-pricing, doc-intelligence, legal-drafter,
// voice-agent. Share the same router, auth, and service-context pattern.
// =============================================================================

function phlMapError(c: AnyCtx, err: { code: string; message: string }) {
  const code = err?.code ?? 'UPSTREAM_ERROR';
  const message = err?.message ?? 'AI-native capability failed';
  const status =
    code === 'BUDGET_EXCEEDED'
      ? 402
      : code === 'VALIDATION'
        ? 422
        : code === 'VOICE_NOT_CONFIGURED' ||
            code === 'ADAPTER_NOT_CONFIGURED' ||
            code === 'LLM_NOT_CONFIGURED'
          ? 503
          : code === 'GUARDRAIL_VIOLATION'
            ? 409
            : 502;
  return c.json({ success: false, error: { code, message } }, status);
}

function phlAiServices(c: AnyCtx): Record<string, any> {
  const services = getServices(c) as any;
  return services.aiNative ?? {};
}

// Resolve tenant-app customer id for voice self-service. Mirrors the pattern
// used in credit-rating.router.ts (customerId claim or userId fallback).
function phlResolveSelfCustomer(c: AnyCtx): string | null {
  const auth = c.get('auth');
  return auth?.customerId ?? auth?.userId ?? null;
}

// --- POST /ai-native/dynamic-pricing/:unitId/propose ------------------------
const DynamicPricingProposeSchema = z.object({
  propertyId: z.string().min(1).max(200).optional(),
  countryCode: z.string().length(2),
  currentRentMinor: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  seasonalityMonth: z.number().int().min(1).max(12).optional(),
  autoQueue: z.boolean().optional(),
  market: z
    .object({
      id: z.string(),
      unitId: z.string(),
      currencyCode: z.string().length(3),
      ourRentMinor: z.number().int().nonnegative(),
      marketMedianMinor: z.number().int().nullable(),
      marketP25Minor: z.number().int().nullable(),
      marketP75Minor: z.number().int().nullable(),
      sampleSize: z.number().int().nonnegative(),
      driftFlag: z.enum(['below_market', 'above_market', 'on_band']).nullable(),
      observedAt: z.string(),
    })
    .optional(),
  occupancy: z
    .object({
      unitId: z.string(),
      windowDays: z.number().int().positive(),
      occupancyPct: z.number().min(0).max(1),
      vacancyDays: z.number().int().nonnegative(),
      rollupHash: z.string(),
    })
    .optional(),
  churn: z
    .object({
      id: z.string(),
      customerId: z.string(),
      unitId: z.string(),
      churnProbability: z.number().min(0).max(1),
      horizonDays: z.number().int().positive(),
    })
    .optional(),
  inspection: z
    .object({
      id: z.string(),
      unitId: z.string(),
      conditionGrade: z.enum(['A', 'B', 'C', 'D', 'F']),
      issuesCount: z.number().int().nonnegative(),
      observedAt: z.string(),
    })
    .optional(),
});

router.post(
  '/dynamic-pricing/:unitId/propose',
  zValidator('json', DynamicPricingProposeSchema),
  withSecurityEvents({ action: 'ai-native.create', resource: 'ai-native', severity: 'info' }, async (c) => {
    try {
      const auth = c.get('auth');
      const unitId = c.req.param('unitId');
      const body = c.req.valid('json');
      const svc = phlAiServices(c).dynamicPricing;
      if (!svc) {
        return unavailable(
          c,
          'ADAPTER_NOT_CONFIGURED',
          'aiNative.dynamicPricing not wired in gateway context',
        );
      }
      const res = await svc.propose(
        {
          tenantId: auth.tenantId,
          unitId,
          propertyId: body.propertyId,
          countryCode: body.countryCode,
          currentRentMinor: body.currentRentMinor,
          currencyCode: body.currencyCode,
          seasonalityMonth: body.seasonalityMonth,
          market: body.market,
          occupancy: body.occupancy,
          churn: body.churn,
          inspection: body.inspection,
        },
        {
          correlationId: c.req.header('x-correlation-id'),
          autoQueue: body.autoQueue,
        },
      );
      if (!res.success) return phlMapError(c, res);
      return c.json({ success: true, data: res.data });
    } catch (err) {
      return internalError(c, err);
    }
  }),
);

// --- POST /ai-native/doc-intelligence/:documentId/extract -------------------
const DocExtractSchema = z.object({
  canonicalText: z.string().min(1),
  languageHint: z.string().min(2).max(8).optional(),
  countryCode: z.string().length(2).optional(),
});

router.post(
  '/doc-intelligence/:documentId/extract',
  zValidator('json', DocExtractSchema),
  withSecurityEvents({ action: 'ai-native.create', resource: 'ai-native', severity: 'info' }, async (c) => {
    try {
      const auth = c.get('auth');
      const documentId = c.req.param('documentId');
      const body = c.req.valid('json');
      const svc = phlAiServices(c).docIntelligence;
      if (!svc) {
        return unavailable(
          c,
          'ADAPTER_NOT_CONFIGURED',
          'aiNative.docIntelligence not wired in gateway context',
        );
      }
      const res = await svc.extract(
        {
          tenantId: auth.tenantId,
          documentId,
          canonicalText: body.canonicalText,
          languageHint: body.languageHint,
          countryCode: body.countryCode,
        },
        { correlationId: c.req.header('x-correlation-id') },
      );
      if (!res.success) return phlMapError(c, res);
      return c.json({ success: true, data: res.data });
    } catch (err) {
      return internalError(c, err);
    }
  }),
);

router.get('/doc-intelligence/:documentId/entities', async (c) => {
  try {
    const auth = c.get('auth');
    const documentId = c.req.param('documentId');
    const repo = phlAiServices(c).docIntelligenceRepo;
    if (!repo) {
      return unavailable(
        c,
        'ADAPTER_NOT_CONFIGURED',
        'aiNative.docIntelligenceRepo not wired in gateway context',
      );
    }
    const entities = await repo.listEntities(auth.tenantId, documentId);
    return c.json({ success: true, data: { entities } });
  } catch (err) {
    return internalError(c, err);
  }
});

router.get('/doc-intelligence/:documentId/obligations', async (c) => {
  try {
    const auth = c.get('auth');
    const documentId = c.req.param('documentId');
    const repo = phlAiServices(c).docIntelligenceRepo;
    if (!repo) {
      return unavailable(
        c,
        'ADAPTER_NOT_CONFIGURED',
        'aiNative.docIntelligenceRepo not wired in gateway context',
      );
    }
    const obligations = await repo.listObligations(auth.tenantId, documentId);
    return c.json({ success: true, data: { obligations } });
  } catch (err) {
    return internalError(c, err);
  }
});

// --- POST /ai-native/legal-draft --------------------------------------------
const LegalDraftSchema = z.object({
  documentKind: z.enum([
    'notice_to_vacate',
    'lease_addendum',
    'demand_letter',
    'eviction_notice',
    'renewal_offer',
    'rent_increase_notice',
    'cure_or_quit',
    'move_out_statement',
    'other',
  ]),
  context: z.object({
    countryCode: z.string().length(2),
    subdivision: z.string().max(40).optional(),
    languageCode: z.string().min(2).max(8).optional(),
    subjectCustomerId: z.string().optional(),
    subjectLeaseId: z.string().optional(),
    subjectPropertyId: z.string().optional(),
    subjectUnitId: z.string().optional(),
  }),
  facts: z.record(z.string(), z.unknown()),
});

router.post('/legal-draft', zValidator('json', LegalDraftSchema), withSecurityEvents({ action: 'ai-native.create', resource: 'ai-native', severity: 'info' }, async (c) => {
  try {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const svc = phlAiServices(c).legalDrafter;
    if (!svc) {
      return unavailable(
        c,
        'ADAPTER_NOT_CONFIGURED',
        'aiNative.legalDrafter not wired in gateway context',
      );
    }
    const res = await svc.draft({
      documentKind: body.documentKind,
      context: {
        tenantId: auth.tenantId,
        countryCode: body.context.countryCode,
        subdivision: body.context.subdivision,
        languageCode: body.context.languageCode,
        subjectCustomerId: body.context.subjectCustomerId,
        subjectLeaseId: body.context.subjectLeaseId,
        subjectPropertyId: body.context.subjectPropertyId,
        subjectUnitId: body.context.subjectUnitId,
      },
      facts: body.facts,
      correlationId: c.req.header('x-correlation-id'),
    });
    if (!res.success) return phlMapError(c, res);
    return c.json({ success: true, data: res.data });
  } catch (err) {
    return internalError(c, err);
  }
}));

router.get('/legal-drafts', async (c) => {
  try {
    const auth = c.get('auth');
    const documentKind = c.req.query('documentKind');
    const limitRaw = c.req.query('limit');
    const repo = phlAiServices(c).legalDraftRepo;
    if (!repo) {
      return unavailable(
        c,
        'ADAPTER_NOT_CONFIGURED',
        'aiNative.legalDraftRepo not wired in gateway context',
      );
    }
    const limit =
      limitRaw !== undefined
        ? Math.max(1, Math.min(200, Number(limitRaw) || 50))
        : 50;
    const drafts = await repo.list(auth.tenantId, {
      documentKind: documentKind || undefined,
      limit,
    });
    return c.json({ success: true, data: { drafts } });
  } catch (err) {
    return internalError(c, err);
  }
});

// --- POST /ai-native/voice/turn ---------------------------------------------
const VoiceTurnSchema = z.object({
  sessionId: z.string().min(1).max(200),
  audioUrl: z.string().url().optional(),
  transcript: z.string().min(1).max(10_000).optional(),
  detectedLanguage: z.string().min(2).max(8).optional(),
  callerPhone: z.string().max(40).optional(),
});

router.post('/voice/turn', zValidator('json', VoiceTurnSchema), withSecurityEvents({ action: 'ai-native.create', resource: 'ai-native', severity: 'info' }, async (c) => {
  try {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const svc = phlAiServices(c).voiceAgent;
    if (!svc) {
      return unavailable(
        c,
        'VOICE_NOT_CONFIGURED',
        'aiNative.voiceAgent not wired in gateway context',
      );
    }
    const res = await svc.turn({
      tenantId: auth.tenantId,
      sessionId: body.sessionId,
      audioUrl: body.audioUrl,
      transcript: body.transcript,
      detectedLanguage: body.detectedLanguage,
      callerPhone: body.callerPhone ?? phlResolveSelfCustomer(c) ?? undefined,
      correlationId: c.req.header('x-correlation-id'),
    });
    if (!res.success) return phlMapError(c, res);
    return c.json({ success: true, data: res.data });
  } catch (err) {
    return internalError(c, err);
  }
}));

export default router;
