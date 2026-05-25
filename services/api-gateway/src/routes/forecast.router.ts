// @ts-nocheck — hono v4 ContextVariableMap drift; tracked in Docs/TYPE_DEBT.md
/**
 * Forecast router — Wave 29.
 *
 *   POST /api/v1/forecast/node
 *     Produce a new per-node forecast, persist it, and emit a
 *     graph-signal into the proactive-loop orchestrator.
 *
 *   GET  /api/v1/forecast/:forecastId
 *     Load a forecast by id — tenantId enforced server-side.
 *
 *   GET  /api/v1/forecast/node/:label/:id
 *     List recent forecasts for a node (tenant-scoped).
 *
 * Auth: every endpoint runs `authMiddleware` + `requireRole` so there
 * is no public surface. The tenantId is ALWAYS taken from the auth
 * context — never from the request body or query, so a caller cannot
 * mint a tenant-scoped forecast against another tenant's graph.
 *
 * Degrades to 503 FORECAST_SERVICE_UNAVAILABLE when the composition
 * root has not wired `services.forecasting.*`. This is intentional —
 * the forecasting slot is only populated when the TGN inference
 * adapter env vars are present. No mock data is ever returned.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  RISK_KINDS,
  type AuthContext,
  type Forecast,
  type ForecastScope,
} from '@borjie/forecasting';
import { GraphSignals, ProactiveLoop } from '@borjie/ai-copilot';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RiskKindEnum = z.enum(RISK_KINDS);

const ForecastNodeBodySchema = z
  .object({
    kind: RiskKindEnum,
    nodeLabel: z.string().min(1).max(64),
    nodeId: z.string().min(1).max(128),
    horizonDays: z.number().int().min(1).max(365),
  })
  .strict();

const ListForecastsQuerySchema = z
  .object({
    kind: RiskKindEnum.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(10),
  })
  .strict();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.PROPERTY_MANAGER,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ForecastServices {
  readonly forecaster: {
    readonly forecast: (
      kind: (typeof RISK_KINDS)[number],
      features: unknown,
      ctx: AuthContext,
    ) => Promise<Forecast>;
  } | null;
  readonly featureExtractor: {
    readonly extract: (
      scope: ForecastScope,
      ctx: AuthContext,
    ) => Promise<unknown>;
  } | null;
  readonly repository: {
    readonly save: (f: Forecast, ctx: AuthContext) => Promise<void>;
    readonly load: (id: string, ctx: AuthContext) => Promise<Forecast | null>;
    readonly listForScope: (
      scope: Pick<ForecastScope, 'tenantId' | 'nodeLabel' | 'nodeId'>,
      ctx: AuthContext,
      limit: number,
    ) => Promise<ReadonlyArray<Forecast>>;
  } | null;
}

function getForecastServices(c: any): ForecastServices | null {
  const services = c.get('services') ?? {};
  return services.forecasting ?? null;
}

function getOrchestrator(c: any):
  | ProactiveLoop.ProactiveOrchestrator
  | null {
  const services = c.get('services') ?? {};
  return services.proactiveOrchestrator ?? null;
}

function unavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'FORECAST_SERVICE_UNAVAILABLE',
        message:
          'Forecast service is not wired on this gateway. Set TGN_INFERENCE_URL and FORECASTING_REPO_URL to enable.',
      },
    },
    503,
  );
}

function authContextFrom(auth: any): AuthContext {
  // auth is populated by authMiddleware and carries tenantId + userId +
  // role. We build a fresh `tenant` AuthContext for every request; the
  // forecaster / feature extractor / repo all assert the scope
  // tenantId matches ctx.tenantId, so passing anything other than the
  // caller's own tenantId is prevented structurally.
  return Object.freeze({
    kind: 'tenant',
    tenantId: String(auth?.tenantId ?? ''),
    actorUserId: String(auth?.userId ?? ''),
    roles: [String(auth?.role ?? '')],
  });
}

// ---------------------------------------------------------------------------
// POST /node — produce a fresh forecast
// ---------------------------------------------------------------------------

app.post(
  '/node',
  zValidator('json', ForecastNodeBodySchema),
  withSecurityEvents({ action: 'forecast.create', resource: 'forecast', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const services = getForecastServices(c);
    if (
      !services ||
      !services.forecaster ||
      !services.featureExtractor ||
      !services.repository
    ) {
      return unavailable(c);
    }

    if (!auth?.tenantId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TENANT_CONTEXT_MISSING',
            message: 'Authenticated request is missing a tenant context',
          },
        },
        400,
      );
    }

    // CRITICAL: tenantId comes from auth, not from the body. A caller
    // cannot spoof a forecast against another tenant's graph.
    const scope: ForecastScope = Object.freeze({
      tenantId: String(auth.tenantId),
      nodeLabel: body.nodeLabel,
      nodeId: body.nodeId,
      horizonDays: body.horizonDays,
    });

    const ctx = authContextFrom(auth);

    try {
      const features = (await services.featureExtractor.extract(
        scope,
        ctx,
      )) as Parameters<
        NonNullable<ForecastServices['forecaster']>['forecast']
      >[1];
      const forecast = await services.forecaster.forecast(
        body.kind,
        features,
        ctx,
      );
      await services.repository.save(forecast, ctx);

      // Fire-and-forward into the proactive-loop orchestrator when one
      // is wired. The orchestrator swallows its own errors (see
      // proactive-orchestrator.ts); failing to emit must NEVER tear
      // down the POST — the forecast itself is the primary output.
      const orchestrator = getOrchestrator(c);
      if (orchestrator) {
        try {
          const emitter = GraphSignals.createGraphSignalEmitter();
          void emitter.emit(forecast, orchestrator);
        } catch {
          // Intentional swallow — orchestrator audit sink records the
          // real failure; the HTTP response must still succeed.
        }
      }

      return c.json({ success: true, data: forecast }, 201);
    } catch (err: any) {
      // Tenant mismatch assertions from forecasting package are fatal
      // and map to 403 — the policy layer refusing the call.
      if (
        typeof err?.message === 'string' &&
        err.message.startsWith('forecasting:') &&
        err.message.includes('tenantId')
      ) {
        return c.json(
          {
            success: false,
            error: {
              code: 'TENANT_SCOPE_MISMATCH',
              message: err.message,
            },
          },
          403,
        );
      }
      return routeCatch(c, err, {
        code: 'FORECAST_PRODUCE_FAILED',
        status: 500,
        fallback: 'Failed to produce forecast',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /:forecastId
// ---------------------------------------------------------------------------

app.get('/:forecastId', async (c: any) => {
  const auth = c.get('auth');
  const forecastId = c.req.param('forecastId');
  const services = getForecastServices(c);
  if (!services || !services.repository) return unavailable(c);

  if (!auth?.tenantId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'TENANT_CONTEXT_MISSING',
          message: 'Authenticated request is missing a tenant context',
        },
      },
      400,
    );
  }

  try {
    const ctx = authContextFrom(auth);
    const forecast = await services.repository.load(forecastId, ctx);
    if (!forecast) {
      return c.json(
        {
          success: false,
          error: { code: 'FORECAST_NOT_FOUND', message: 'Forecast not found' },
        },
        404,
      );
    }
    // Belt-and-braces tenant check: the repository SHOULD already have
    // enforced this at the query layer, but we never trust a
    // cross-tenant response — refuse it at the router boundary too.
    if (forecast.scope.tenantId !== String(auth.tenantId)) {
      return c.json(
        {
          success: false,
          error: { code: 'FORECAST_NOT_FOUND', message: 'Forecast not found' },
        },
        404,
      );
    }
    return c.json({ success: true, data: forecast });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'FORECAST_FETCH_FAILED',
      status: 500,
      fallback: 'Failed to fetch forecast',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /node/:label/:id — list recent forecasts for a node
// ---------------------------------------------------------------------------

app.get(
  '/node/:label/:id',
  zValidator('query', ListForecastsQuerySchema),
  async (c: any) => {
    const auth = c.get('auth');
    const label = c.req.param('label');
    const id = c.req.param('id');
    const query = c.req.valid('query');
    const services = getForecastServices(c);
    if (!services || !services.repository) return unavailable(c);

    if (!auth?.tenantId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'TENANT_CONTEXT_MISSING',
            message: 'Authenticated request is missing a tenant context',
          },
        },
        400,
      );
    }

    try {
      const ctx = authContextFrom(auth);
      const all = await services.repository.listForScope(
        {
          tenantId: String(auth.tenantId),
          nodeLabel: label,
          nodeId: id,
        },
        ctx,
        query.limit,
      );
      // Optional `kind` filter narrows the repo result without
      // introducing another repo method.
      const filtered = query.kind
        ? all.filter((f) => f.kind === query.kind)
        : all;
      return c.json({
        success: true,
        data: filtered,
        meta: {
          total: filtered.length,
          limit: query.limit,
          nodeLabel: label,
          nodeId: id,
          kind: query.kind ?? null,
        },
      });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'FORECAST_LIST_FAILED',
        status: 500,
        fallback: 'Failed to list forecasts',
      });
    }
  },
);

export default app;
