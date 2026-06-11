/**
 * /api/v1/mining/internal/decision-trace — INV-A-safe decision-trace replay
 * (FIRE-2).
 *
 * REPLACES the old admin-web service-role Supabase client (which read
 * `decision_traces` content for ANY `?tenant=` with no break-glass gate and
 * held SUPABASE_SERVICE_ROLE_KEY inside a public Next.js app). This route is
 * the single gateway seam the admin console uses instead.
 *
 * Two trust tiers:
 *   GET /                 metadata-only list (control-plane-safe: id, tenant,
 *                         action name, outcome, timing, ids). NO decision
 *                         CONTENT (inputs / branches / rationale / output /
 *                         attributes). Always allowed for SUPER_ADMIN / ADMIN.
 *   GET /:id              metadata-only header for one trace. Always allowed.
 *   GET /:id/content      the FULL decision content — tenant BUSINESS DATA.
 *                         Gated by `requireBreakGlass('decision_trace_content')`:
 *                         deny-by-default unless a tenant-consented, time-boxed
 *                         grant exists; every served read is hash-chain audited
 *                         and tenant-visible.
 *
 * SUPER_ADMIN / ADMIN role-gated throughout. The metadata reads use
 * `withServiceRoleContext` to span tenants (control-plane aggregate) but
 * project ONLY metadata columns; the content read additionally requires the
 * break-glass grant.
 */

import { Hono } from 'hono';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { decisionTraces, withServiceRoleContext } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddlewareNoPin } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  recordBreakGlassAccess,
  requireBreakGlass,
} from '../../../middleware/break-glass';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('internal-decision-trace');

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddlewareNoPin);

// Metadata-only projection — control-plane-safe. Deliberately EXCLUDES
// inputs / branches / chosenRationale / attributes / output / error.
const METADATA_COLUMNS = {
  id: decisionTraces.id,
  tenantId: decisionTraces.tenantId,
  name: decisionTraces.name,
  startedAt: decisionTraces.startedAt,
  finalisedAt: decisionTraces.finalisedAt,
  durationMs: decisionTraces.durationMs,
  outcome: decisionTraces.outcome,
  chosenBranchId: decisionTraces.chosenBranchId,
  userId: decisionTraces.userId,
  requestId: decisionTraces.requestId,
  parentTraceId: decisionTraces.parentTraceId,
} as const;

// GET / — metadata-only list.
app.get('/', async (c: any) => {
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const tenant = (c.req.query('tenant') ?? '').trim();
  const outcome = (c.req.query('outcome') ?? '').trim();
  const cursor = (c.req.query('cursor') ?? '').trim();
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') ?? '50', 10) || 50));

  const conds: SQL[] = [];
  if (tenant) conds.push(eq(decisionTraces.tenantId, tenant));
  if (outcome) conds.push(eq(decisionTraces.outcome, outcome));
  if (cursor) conds.push(lt(decisionTraces.startedAt, new Date(cursor)));

  const rows = await withServiceRoleContext(db, async (tx) => {
    const base = tx
      .select(METADATA_COLUMNS)
      .from(decisionTraces)
      .orderBy(desc(decisionTraces.startedAt))
      .limit(limit);
    return conds.length > 0 ? base.where(and(...conds)) : base;
  });
  return c.json({ success: true, data: rows, meta: { count: rows.length } }, 200);
});

// GET /:id — metadata-only header for one trace.
app.get('/:id', async (c: any) => {
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const id = c.req.param('id');
  const rows = await withServiceRoleContext(db, async (tx) =>
    tx.select(METADATA_COLUMNS).from(decisionTraces).where(eq(decisionTraces.id, id)).limit(1),
  );
  const row = rows[0];
  if (!row) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Trace not found' } },
      404,
    );
  }
  return c.json({ success: true, data: row }, 200);
});

// GET /:id/content — FULL decision content (tenant business data). Break-glass
// gated. The middleware resolves the target tenant from `?tenant`; the trace's
// own tenant must match so a grant for tenant A cannot read tenant B's trace.
const contentApp = new Hono();
contentApp.use('*', authMiddleware);
contentApp.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
contentApp.use('*', databaseMiddlewareNoPin);
contentApp.use('*', requireBreakGlass('decision_trace_content'));

contentApp.get('/:id/content', async (c: any) => {
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const id = c.req.param('id');
  const grantTenant = c.get('breakGlassTenantId') as string;
  const rows = await withServiceRoleContext(db, async (tx) =>
    tx.select().from(decisionTraces).where(eq(decisionTraces.id, id)).limit(1),
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Trace not found' } },
      404,
    );
  }
  // Defence-in-depth: the grant is for `grantTenant`; refuse to serve a trace
  // belonging to a DIFFERENT tenant even if the id was guessed.
  if (row.tenantId != null && String(row.tenantId) !== grantTenant) {
    logger.warn('decision-trace content tenant mismatch', {
      evt: 'break_glass_tenant_mismatch',
      grantTenant,
      traceTenant: String(row.tenantId),
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'BREAK_GLASS_TENANT_MISMATCH',
          message: 'Grant tenant does not match the trace tenant',
        },
      },
      403,
    );
  }

  await recordBreakGlassAccess(c, {
    route: 'internal/decision-trace/:id/content',
    scope: 'decision_trace_content',
    rowCount: 1,
  });

  return c.json({ success: true, data: row }, 200);
});

app.route('/', contentApp);

export const miningInternalDecisionTraceRouter = app;
