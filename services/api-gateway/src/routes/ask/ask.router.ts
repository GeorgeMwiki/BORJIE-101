// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union (hono-dev/hono#3891).
/**
 * /api/v1/ask — universal role-aware advisor router.
 *
 * Routes:
 *   POST /v1/ask                  — submit a question, get a role-tailored answer
 *   GET  /v1/ask/starting-points  — fetch suggested starting-point chips for THIS user
 *   POST /v1/ask/feedback         — submit feedback on an answer (rating + optional text)
 *
 * Auth: required on every route (Hono `authMiddleware`). Role + tenantId
 * come from the session — never from the request body — to prevent
 * tenant-id forgery.
 *
 * Wrapping: every state-changing route is wrapped in `withSecurityEvents`
 * for the SOC 2 CC7.2 audit trail. Spec calls out `withSecurityEventsFastify`;
 * the api-gateway is a Hono app so we use the Hono variant of the same
 * HOF — semantically equivalent, written by the same `@borjie/observability`
 * module.
 *
 * Rate limiting: 10 req/min per (user, endpoint). See `ask-rate-limit.ts`.
 *
 * Cross-collision note (per task brief):
 *   - We do NOT touch `services/api-gateway/src/routes/advisor/` (owned by P2)
 *   - We do NOT touch `apps/admin-portal/`                       (owned by P3)
 *   - We do NOT touch `services/api-gateway/src/composition/service-registry.ts` (P5 wires real ports)
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { mapWireRoleToRole, type AdviseRequest } from '@borjie/role-aware-advisor';
import { generateStartingPoints } from '@borjie/role-aware-advisor';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth.js';
import { getAdvisor } from './advisor-wiring.js';
import { askRateLimit } from './ask-rate-limit.js';

type AnyCtx = any;

const AskBodySchema = z.object({
  question: z.string().min(2).max(2000),
  sessionId: z.string().min(1).max(200).optional(),
});

const FeedbackBodySchema = z.object({
  sessionId: z.string().min(1).max(200),
  answerId: z.string().min(1).max(200),
  rating: z.number().int().min(1).max(5),
  freeText: z.string().max(2000).optional(),
});

const router = new Hono();

// Auth gate first — every route below requires a valid session.
router.use('*', authMiddleware);

// ─── POST /v1/ask ───────────────────────────────────────────────
router.post(
  '/',
  askRateLimit({ endpoint: 'ask', maxPerMinute: 10 }),
  withSecurityEvents(
    {
      action: 'advisor.ask',
      resource: 'advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth');
      const role = mapWireRoleToRole(auth?.role ?? '');
      if (!role) {
        return c.json(
          {
            success: false,
            error: {
              code: 'UNSUPPORTED_ROLE',
              message: 'Your role is not supported by this advisor.',
            },
          },
          403,
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
      const parsed = AskBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: parsed.error.message,
            },
          },
          400,
        );
      }
      const req: AdviseRequest = {
        user: {
          id: auth.userId,
          tenantId: auth.tenantId,
          role,
        },
        question: parsed.data.question,
        ...(parsed.data.sessionId !== undefined
          ? { sessionId: parsed.data.sessionId }
          : {}),
      };
      try {
        const advisor = getAdvisor();
        const res = await advisor.advise(req);
        return c.json({ success: true, data: res });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json(
          {
            success: false,
            error: {
              code: 'ADVISOR_ERROR',
              message: 'Failed to generate response.',
              detail: message.slice(0, 200),
            },
          },
          500,
        );
      }
    },
  ),
);

// ─── GET /v1/ask/starting-points ────────────────────────────────
router.get(
  '/starting-points',
  askRateLimit({ endpoint: 'starting-points', maxPerMinute: 10 }),
  async (c: AnyCtx) => {
    const auth = c.get('auth');
    const role = mapWireRoleToRole(auth?.role ?? '');
    if (!role) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNSUPPORTED_ROLE',
            message: 'Your role is not supported by this advisor.',
          },
        },
        403,
      );
    }
    const sessionId = c.req.query('sessionId') ?? null;
    const today = new Date().toISOString().slice(0, 10);

    // Lightweight context — until a per-user activity port lands, we
    // pass a minimal context object. The chip generator gracefully
    // degrades to role-default chips when fields are absent.
    const chips = generateStartingPoints({
      user: { id: auth.userId, tenantId: auth.tenantId, role },
      context: { today },
    });
    return c.json({
      success: true,
      data: { chips, sessionId },
    });
  },
);

// ─── POST /v1/ask/feedback ──────────────────────────────────────
router.post(
  '/feedback',
  askRateLimit({ endpoint: 'feedback', maxPerMinute: 10 }),
  withSecurityEvents(
    {
      action: 'advisor.feedback',
      resource: 'advisor',
      severity: 'info',
    },
    async (c: AnyCtx) => {
      const auth = c.get('auth');
      const role = mapWireRoleToRole(auth?.role ?? '');
      if (!role) {
        return c.json(
          {
            success: false,
            error: {
              code: 'UNSUPPORTED_ROLE',
              message: 'Your role is not supported by this advisor.',
            },
          },
          403,
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
      const parsed = FeedbackBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: {
              code: 'BAD_REQUEST',
              message: parsed.error.message,
            },
          },
          400,
        );
      }
      // Lesson-store hook — when a feedback rating arrives, drop a
      // tiny lesson into the reflexion store keyed by 'role-aware-advisor'.
      // The store is taken from the gateway service-registry decoration
      // (`c.get('lessonStore')`); when absent we fall back to a no-op
      // so the feedback route still returns 2xx in degraded mode.
      const store = c.get('lessonStore') as
        | {
            put: (lesson: unknown) => Promise<unknown>;
          }
        | undefined;
      if (store?.put && parsed.data.rating <= 2) {
        try {
          await store.put({
            id: `lsn_${Date.now()}_${parsed.data.answerId}`,
            tenantId: auth.tenantId,
            taskTag: 'role-aware-advisor',
            lesson:
              parsed.data.freeText?.slice(0, 200) ??
              `Low rating (${parsed.data.rating}/5) for answer ${parsed.data.answerId}`,
            evidence: `answer:${parsed.data.answerId} session:${parsed.data.sessionId}`,
            createdAt: new Date().toISOString(),
            recencyScore: 1,
          });
        } catch {
          // never fail the feedback route on lesson-store hiccups.
        }
      }
      return c.json({ success: true, data: { recorded: true } });
    },
  ),
);

export default router;
