/**
 * Portal-GenUI router.
 *
 * Mounted at `/api/v1/portal-genui`. Drives the dynamic-tab generator
 * end-to-end:
 *
 *   POST /v1/portal-genui/detect    — classify a user message
 *   POST /v1/portal-genui/generate  — draft a PortalTab from an intent
 *   POST /v1/portal-genui/tabs      — persist a generated tab
 *   GET  /v1/portal-genui/tabs      — list tabs for (tenant, user)
 *   GET  /v1/portal-genui/tabs/:id  — fetch one tab
 *   DELETE /v1/portal-genui/tabs/:id — delete one tab
 *
 * Tenant id + actor id come from `c.get('auth')` (JWT-derived). The
 * client never supplies these in the request body — that would let a
 * caller forge a tenant.
 *
 * Every state-changing route is wrapped in `withSecurityEvents` for
 * the SOC 2 audit trail (mirrors `ask.router.ts`). Brief said
 * `withSecurityEventsFastify`; the api-gateway is a Hono app so we
 * use the Hono variant of the same helper.
 *
 * The genUI engine is read off `c.get('services').portalGenUIEngine`
 * — the composition root wires it. When the engine is missing every
 * route returns 503 with a config-missing code rather than crashing.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';
import {
  TabGenerationIntentSchema,
  type GenUIEngine,
} from '@borjie/portal-genui';
import { authMiddleware } from '../../middleware/hono-auth.js';

type AnyCtx = any;

function getServices(c: AnyCtx): Record<string, unknown> {
  return c.get('services') ?? {};
}

function getEngine(c: AnyCtx): GenUIEngine | undefined {
  return getServices(c).portalGenUIEngine as GenUIEngine | undefined;
}

function unavailable(c: AnyCtx, code: string, message: string) {
  return c.json({ success: false, error: { code, message } }, 503);
}

// ────────────────────────────────────────────────────────────────────
// Request schemas
// ────────────────────────────────────────────────────────────────────

const DetectBodySchema = z
  .object({
    message: z.string().min(1).max(4000),
    /**
     * Optional role-bias — defaults to the auth role from the JWT.
     * Callers MAY override (e.g. an admin role-switching) but the
     * value is never used to bypass tenant scope.
     */
    role: z
      .enum([
        'internal_admin',
        'property_manager',
        'estate_manager',
        'owner',
        'customer',
      ])
      .optional(),
  })
  .strict();

const GenerateBodySchema = z
  .object({
    intent: TabGenerationIntentSchema,
    orgContext: z
      .object({
        tenantName: z.string().max(120).optional(),
        tenantRegion: z.string().max(60).optional(),
        tenantCurrency: z.string().length(3).optional(),
        userPersona: z
          .enum([
            'internal_admin',
            'property_manager',
            'estate_manager',
            'owner',
            'customer',
          ])
          .optional(),
        existingTabKeys: z.array(z.string().min(1).max(120)).max(200).optional(),
      })
      .strict()
      .optional(),
    /**
     * Optional reference to the chat conversation that triggered
     * this generation — used for the audit-trail `sourceConversationId`.
     */
    sourceConversationId: z.string().max(200).optional(),
    /** When provided, persist the generated tab atomically. */
    persist: z.boolean().optional(),
  })
  .strict();

const SaveTabBodySchema = z
  .object({
    /** Full validated tab. The route revalidates server-side. */
    tab: z.record(z.unknown()),
    parentTabId: z.string().min(1).max(120).optional(),
  })
  .strict();

const ListTabsQuerySchema = z
  .object({
    userId: z.string().min(1).max(120).optional(),
    tenantDefault: z
      .enum(['true', 'false'])
      .optional(),
    persona: z
      .enum([
        'internal_admin',
        'property_manager',
        'estate_manager',
        'owner',
        'customer',
      ])
      .optional(),
    domain: z
      .enum([
        'hr',
        'finance',
        'compliance',
        'procurement',
        'operations',
        'sales',
        'marketing',
        'engineering',
        'legal',
        'sustainability',
        'custom',
      ])
      .optional(),
  })
  .strict();

// ────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────

const router = new Hono();
router.use('*', authMiddleware);

// ─── POST /v1/portal-genui/detect ──────────────────────────────
router.post(
  '/detect',
  withSecurityEvents(
    {
      action: 'portal-genui.detect',
      resource: 'portal-genui',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = DetectBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      const auth = c.get('auth');
      const intent = await engine.detectIntent({
        message: parsed.data.message,
        role: parsed.data.role ?? (auth?.role as never),
      });
      return c.json({ success: true, data: { intent } });
    },
  ),
);

// ─── POST /v1/portal-genui/generate ────────────────────────────
router.post(
  '/generate',
  withSecurityEvents(
    {
      action: 'portal-genui.generate',
      resource: 'portal-genui',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = GenerateBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      const auth = c.get('auth');
      if (!auth?.tenantId || !auth?.userId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'MISSING_TENANT_OR_USER',
              message: 'auth context missing tenantId/userId',
            },
          },
          401,
        );
      }
      try {
        const orgCtx = parsed.data.orgContext ? {
          ...(parsed.data.orgContext.tenantRegion && { tenantRegion: parsed.data.orgContext.tenantRegion }),
          ...(parsed.data.orgContext.tenantName && { tenantName: parsed.data.orgContext.tenantName }),
          ...(parsed.data.orgContext.tenantCurrency && { tenantCurrency: parsed.data.orgContext.tenantCurrency }),
          ...(parsed.data.orgContext.userPersona && { userPersona: parsed.data.orgContext.userPersona }),
          ...(parsed.data.orgContext.existingTabKeys && { existingTabKeys: parsed.data.orgContext.existingTabKeys }),
        } : undefined;
        const result = await engine.generate({
          intent: parsed.data.intent,
          tenantId: auth.tenantId,
          userId: auth.userId,
          actorId: auth.userId,
          ...(orgCtx && { orgContext: orgCtx }),
          ...(parsed.data.sourceConversationId && { sourceConversationId: parsed.data.sourceConversationId }),
        });
        if (parsed.data.persist) {
          await engine.persist({ tab: result.tab });
        }
        return c.json({
          success: true,
          data: {
            tab: result.tab,
            source: result.source,
            llmModelId: result.llmModelId,
            latencyMs: result.latencyMs,
            persisted: parsed.data.persist === true,
          },
        });
      } catch (err) {
        return c.json(
          {
            success: false,
            error: {
              code: 'GENERATION_FAILED',
              message:
                err instanceof Error ? err.message : 'unknown error',
            },
          },
          500,
        );
      }
    },
  ),
);

// ─── POST /v1/portal-genui/tabs ────────────────────────────────
router.post(
  '/tabs',
  withSecurityEvents(
    {
      action: 'portal-genui.save-tab',
      resource: 'portal-genui',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
          },
          400,
        );
      }
      const parsed = SaveTabBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: { code: 'BAD_REQUEST', message: parsed.error.message },
          },
          400,
        );
      }
      const auth = c.get('auth');
      if (!auth?.tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'auth missing tenantId' },
          },
          401,
        );
      }
      // Enforce tenant + actor server-side — never trust the body.
      const tabAny = parsed.data.tab as Record<string, unknown>;
      const enforced = {
        ...tabAny,
        tenantId: auth.tenantId,
      };
      try {
        const saved = await engine.persist({
          tab: enforced as never,
          ...(parsed.data.parentTabId !== undefined
            ? { parentTabId: parsed.data.parentTabId }
            : {}),
        });
        return c.json({ success: true, data: saved }, 201);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown';
        if (msg.includes('tab_key_already_exists')) {
          return c.json(
            {
              success: false,
              error: { code: 'TAB_KEY_CONFLICT', message: msg },
            },
            409,
          );
        }
        return c.json(
          {
            success: false,
            error: { code: 'INVALID_TAB', message: msg },
          },
          400,
        );
      }
    },
  ),
);

// ─── GET /v1/portal-genui/tabs ─────────────────────────────────
router.get('/tabs', async (c: AnyCtx) => {
  const engine = getEngine(c);
  if (!engine) {
    return unavailable(
      c,
      'PORTAL_GENUI_ENGINE_MISSING',
      'portal-genui engine is not wired in this environment',
    );
  }
  const auth = c.get('auth');
  if (!auth?.tenantId) {
    return c.json(
      {
        success: false,
        error: { code: 'MISSING_TENANT', message: 'auth missing tenantId' },
      },
      401,
    );
  }
  const rawQuery = c.req.query();
  const parsed = ListTabsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      },
      400,
    );
  }
  const tenantDefault = parsed.data.tenantDefault === 'true';
  const userId = tenantDefault
    ? null
    : parsed.data.userId ?? auth.userId ?? null;
  const tabs = await engine.list({
    tenantId: auth.tenantId,
    userId,
    ...(parsed.data.persona !== undefined ? { personaId: parsed.data.persona } : {}),
    ...(parsed.data.domain !== undefined ? { domain: parsed.data.domain } : {}),
  });
  return c.json({ success: true, data: { tabs } });
});

// ─── GET /v1/portal-genui/tabs/:id ─────────────────────────────
router.get('/tabs/:id', async (c: AnyCtx) => {
  const engine = getEngine(c);
  if (!engine) {
    return unavailable(
      c,
      'PORTAL_GENUI_ENGINE_MISSING',
      'portal-genui engine is not wired in this environment',
    );
  }
  const auth = c.get('auth');
  const id = c.req.param('id');
  const tab = await engine.get(id);
  if (!tab) {
    return c.json(
      {
        success: false,
        error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
      },
      404,
    );
  }
  if (tab.tenantId !== auth?.tenantId) {
    return c.json(
      {
        success: false,
        error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
      },
      404,
    );
  }
  return c.json({ success: true, data: { tab } });
});

// ─── DELETE /v1/portal-genui/tabs/:id ──────────────────────────
router.delete(
  '/tabs/:id',
  withSecurityEvents(
    {
      action: 'portal-genui.delete-tab',
      resource: 'portal-genui',
      severity: 'notice',
    },
    async (c: AnyCtx) => {
      const engine = getEngine(c);
      if (!engine) {
        return unavailable(
          c,
          'PORTAL_GENUI_ENGINE_MISSING',
          'portal-genui engine is not wired in this environment',
        );
      }
      const auth = c.get('auth');
      if (!auth?.tenantId) {
        return c.json(
          {
            success: false,
            error: { code: 'MISSING_TENANT', message: 'auth missing tenantId' },
          },
          401,
        );
      }
      const id = c.req.param('id');
      const out = await engine.delete({
        tabId: id,
        requesterId: auth.userId ?? 'system',
        tenantId: auth.tenantId,
      });
      if (!out.deleted) {
        return c.json(
          {
            success: false,
            error: { code: 'TAB_NOT_FOUND', message: `tab ${id} not found` },
          },
          404,
        );
      }
      return c.json({ success: true, data: { deleted: true } });
    },
  ),
);

export default router;
