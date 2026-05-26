/**
 * Persona registry router — Phase D D7 admin-gated CRUD.
 *
 * Mounted at `/api/v1/persona-registry`.
 *
 *   GET    /persona-registry             — list every persona (platform + tenant)
 *   GET    /persona-registry/:id         — read a single persona
 *   POST   /persona-registry             — register a new persona
 *   PUT    /persona-registry/:id         — patch an existing persona
 *   DELETE /persona-registry/:id         — remove a persona
 *   POST   /persona-registry/refresh     — force-re-read from the DB
 *
 * Access: SUPER_ADMIN / ADMIN only. Tenant-scoped admins do NOT have
 * write access today — persona hot-swaps fan out via the cross-portal
 * bus and are a platform-wide concern.
 *
 * Service slot: `services.personaRegistry` (kernel PersonaRegistry).
 * Returns 503 NOT_IMPLEMENTED when the slot is null (degraded mode).
 */

import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';

import { withSecurityEvents } from '@borjie/observability';

/** Router dispatches at runtime — Hono's generic Context is sufficient. */
type AnyContext = Context;

interface PersonaRegistry {
  list(): unknown;
  get(id: string): unknown;
  register(input: unknown): Promise<unknown>;
  update(id: string, patch: unknown): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  refresh(): Promise<unknown>;
}

const PersonaSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  openingStatement: z.string().min(1),
  toneGuidance: z.string().min(1),
  taboos: z.array(z.string()).default([]),
  violationSignals: z.array(z.string()).default([]),
  firstPersonNoun: z.string().min(1),
});

const PersonaPatchSchema = PersonaSchema.partial().omit({ id: true });

const app = new Hono();
app.use('*', authMiddleware);

function reg(c: AnyContext): PersonaRegistry | undefined {
  const services =
    (c.get('services') as { personaRegistry?: PersonaRegistry } | undefined) ?? {};
  return services.personaRegistry;
}

function notImplemented(c: AnyContext) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'PersonaRegistry service not wired into api-gateway context',
      },
    },
    503,
  );
}

app.get(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (c: AnyContext) => {
    const r = reg(c);
    if (!r) return notImplemented(c);
    return c.json({ success: true, data: r.list() }, 200);
  },
);

app.get(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  async (c: AnyContext) => {
    const r = reg(c);
    if (!r) return notImplemented(c);
    const id = c.req.param('id');
    const found = r.get(id);
    if (!found) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: `unknown persona '${id}'` } },
        404,
      );
    }
    return c.json({ success: true, data: found }, 200);
  },
);

app.post(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  zValidator('json', PersonaSchema),
  withSecurityEvents({ action: 'persona.create', resource: 'persona', severity: 'info' }, async (c: AnyContext) => {
    const r = reg(c);
    if (!r) return notImplemented(c);
    const body = c.req.valid('json');
    try {
      const persona = await r.register(body);
      return c.json({ success: true, data: persona }, 201);
    } catch (e: unknown) {
      const err = e as { message?: string };
      return c.json(
        { success: false, error: { code: 'VALIDATION', message: err?.message ?? 'invalid persona' } },
        400,
      );
    }
  }),
);

app.put(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  zValidator('json', PersonaPatchSchema),
  withSecurityEvents({ action: 'persona.update', resource: 'persona', severity: 'info' }, async (c: AnyContext) => {
    const r = reg(c);
    if (!r) return notImplemented(c);
    const id = c.req.param('id');
    const body = c.req.valid('json');
    try {
      const updated = await r.update(id, body);
      return c.json({ success: true, data: updated }, 200);
    } catch (e: unknown) {
      const err = e as { message?: string };
      const status = /unknown persona/i.test(err?.message ?? '') ? 404 : 400;
      return c.json(
        { success: false, error: { code: status === 404 ? 'NOT_FOUND' : 'VALIDATION', message: err?.message ?? 'invalid' } },
        status,
      );
    }
  }),
);

app.delete(
  '/:id',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  withSecurityEvents({ action: 'persona.delete', resource: 'persona', severity: 'notice' }, async (c: AnyContext) => {
    const r = reg(c);
    if (!r) return notImplemented(c);
    const id = c.req.param('id');
    const removed = await r.delete(id);
    if (!removed) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: `unknown persona '${id}'` } },
        404,
      );
    }
    return c.json({ success: true, data: { id, removed: true } }, 200);
  }),
);

app.post(
  '/refresh',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN),
  withSecurityEvents({ action: 'persona.create', resource: 'persona', severity: 'info' }, async (c: AnyContext) => {
    const r = reg(c);
    if (!r) return notImplemented(c);
    await r.refresh();
    return c.json({ success: true, data: { refreshed: true } }, 200);
  }),
);

export default app;
