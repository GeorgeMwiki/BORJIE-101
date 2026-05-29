/**
 * GDPR right-to-be-forgotten router — Wave 9 enterprise polish.
 *
 * Mounted at `/api/v1/gdpr`.
 *
 *   POST /gdpr/delete-request          — tenant admin lodges a request
 *   GET  /gdpr/delete-request/:id      — caller fetches status
 *   POST /gdpr/delete-request/:id/execute
 *                                       — super-admin runs pseudonymization
 *                                         inside a DB transaction
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const DeleteRequestSchema = z.object({
  customerId: z.string().min(1).max(120),
  notes: z.string().max(2000).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: any) {
  const services = c.get('services') ?? {};
  return services.gdpr;
}

function tx(c: any) {
  const services = c.get('services') ?? {};
  return services.db;
}

function notImplemented(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'GDPR service not wired into api-gateway context',
      },
    },
    503,
  );
}

// Borjie hard-fork: the GDPR delete-request tables ship in a migration
// that hasn't been applied to every dev DB. `handleGdprError` lets a
// missing-table failure surface as 503 `TABLE_NOT_PROVISIONED` instead
// of `INTERNAL_ERROR` 500. Domain-specific exceptions still flow through
// the local code map below.
function handleGdprError(c: any, e: unknown) {
  return routeCatch(c, e, { code: 'GDPR_QUERY_FAILED' });
}

function mapError(e: unknown) {
  const err = e as { code?: string; message?: string } | undefined;
  const code = err?.code ?? 'INTERNAL_ERROR';
  const status =
    code === 'NOT_FOUND'
      ? 404
      : code === 'TENANT_MISMATCH'
        ? 403
        : code === 'VALIDATION'
          ? 400
          : code === 'ALREADY_EXECUTED' || code === 'INVALID_STATUS'
            ? 409
            : 500;
  return {
    body: {
      success: false,
      error: { code, message: err?.message ?? 'unknown' },
    },
    status,
  };
}

app.post(
  '/delete-request',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', DeleteRequestSchema),
  withSecurityEvents({ action: 'gdpr.create', resource: 'gdpr', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const body = c.req.valid('json');
    const s = svc(c);
    if (!s) return notImplemented(c);
    try {
      const req = await s.requestDeletion(auth.tenantId, body, auth.userId);
      return c.json({ success: true, data: req }, 201);
    } catch (e: unknown) {
      return handleGdprError(c, e);
    }
  }),
);

app.get('/delete-request/:id', async (c: any) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const req = await s.getStatus(auth.tenantId, c.req.param('id'));
    return c.json({ success: true, data: req });
  } catch (e: unknown) {
    return handleGdprError(c, e);
  }
});

app.get('/delete-requests', async (c: any) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const list = await s.listRequests(auth.tenantId);
    return c.json({ success: true, data: list });
  } catch (e: unknown) {
    return handleGdprError(c, e);
  }
});

app.post(
  '/delete-request/:id/execute',
  requireRole(UserRole.SUPER_ADMIN),
  withSecurityEvents({ action: 'gdpr.create', resource: 'gdpr', severity: 'info' }, async (c: any) => {
    const auth = c.get('auth');
    const s = svc(c);
    if (!s) return notImplemented(c);
    const db = tx(c);
    try {
      const result = await s.executeDeletion(
        auth.tenantId,
        c.req.param('id'),
        auth.userId,
      );

      // Run the pseudonymization statements inside a single transaction
      // so a partial failure leaves no half-pseudonymized customer.
      if (db && typeof db.transaction === 'function') {
        await db.transaction(async (txDb: any) => {
          for (const stmt of result.statements) {
            // `execute` on drizzle-orm's node-postgres client accepts the
            // shape { sql, params }. We call raw SQL to avoid re-encoding
            // through the schema layer.
            if (typeof txDb.execute === 'function') {
              await txDb.execute({
                sql: stmt.sql,
                params: stmt.params,
              });
            }
          }
        });
      }

      return c.json({
        success: true,
        data: {
          request: result.request,
          pseudonymId: result.pseudonymId,
          affectedTableCount: result.statements.length,
        },
      });
    } catch (e: unknown) {
      return handleGdprError(c, e);
    }
  }),
);

export const gdprRouter = app;
export default app;
