/**
 * /api/v1/mining/internal/support/tickets — HQ support-queue list.
 *
 * SUPER_ADMIN / ADMIN only. The "ticket" surface inside Borjie HQ is the union
 * of unresolved `compliance_escalations` rows (Compliance Agent fan-in →
 * operator review queue).
 *
 * INV-A / FIRE-4 — METADATA vs CONTENT split. The escalation `summary` is the
 * FREE-TEXT body of a tenant's compliance escalation — tenant BUSINESS DATA,
 * not platform metadata. So this route splits into two projections:
 *   - DEFAULT (metadata): id, tenantId, severity, openedAt, SLA, counts. The
 *     `summary` is REDACTED to a placeholder. Always allowed.
 *   - CONTENT (`GET /content?tenant=…`): includes the `summary` body, gated by
 *     `requireBreakGlass('support_ticket_content')` — deny-by-default unless
 *     the tenant has consented to a time-boxed grant; every read hash-chain
 *     audited + tenant-visible. Single-tenant scoped (the grant is per-tenant),
 *     so the content path is filtered to the grant's tenant.
 */

import { Hono } from 'hono';
import { desc, eq, isNull, and } from 'drizzle-orm';
import { complianceEscalations, withServiceRoleContext } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddlewareNoPin } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  recordBreakGlassAccess,
  requireBreakGlass,
} from '../../../middleware/break-glass';

const REDACTED = '[redacted — request break-glass to view content]';

interface SupportTicketRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly source: 'compliance-escalation';
  readonly severity: string;
  readonly summary: string;
  readonly openedAt: string;
  readonly ackedAt: string | null;
}

function projectRow(
  row: Record<string, unknown>,
  withContent: boolean,
): SupportTicketRow {
  return {
    id: String(row['id']),
    tenantId: row['tenantId'] != null ? String(row['tenantId']) : null,
    source: 'compliance-escalation' as const,
    severity: String(row['severity'] ?? 'medium'),
    summary: withContent ? String(row['summary'] ?? '') : REDACTED,
    openedAt:
      row['escalatedAt'] instanceof Date
        ? row['escalatedAt'].toISOString()
        : String(row['escalatedAt'] ?? new Date(0).toISOString()),
    ackedAt: null,
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddlewareNoPin);

// GET / — metadata-only (summary REDACTED) across all tenants.
app.get('/', async (c: any) => {
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const rows = await withServiceRoleContext(db, async (tx) =>
    tx
      .select()
      .from(complianceEscalations)
      .where(isNull(complianceEscalations.resolvedAt))
      .orderBy(desc(complianceEscalations.escalatedAt))
      .limit(200),
  );

  const data = rows.map((r: Record<string, unknown>) => projectRow(r, false));

  return c.json(
    {
      success: true as const,
      data,
      meta: { count: data.length, source: 'compliance_escalations' as const, content: false },
    },
    200,
  );
});

// GET /content?tenant=… — includes the free-text summary; break-glass gated +
// single-tenant scoped.
const contentApp = new Hono();
contentApp.use('*', authMiddleware);
contentApp.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
contentApp.use('*', databaseMiddlewareNoPin);
contentApp.use('*', requireBreakGlass('support_ticket_content'));

contentApp.get('/content', async (c: any) => {
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const tenantId = c.get('breakGlassTenantId') as string;
  const rows = await withServiceRoleContext(db, async (tx) =>
    tx
      .select()
      .from(complianceEscalations)
      .where(
        and(
          isNull(complianceEscalations.resolvedAt),
          eq(complianceEscalations.tenantId, tenantId),
        ),
      )
      .orderBy(desc(complianceEscalations.escalatedAt))
      .limit(200),
  );

  const data = rows.map((r: Record<string, unknown>) => projectRow(r, true));

  await recordBreakGlassAccess(c, {
    route: 'internal/support/tickets/content',
    scope: 'support_ticket_content',
    rowCount: data.length,
  });

  return c.json(
    {
      success: true as const,
      data,
      meta: { count: data.length, source: 'compliance_escalations' as const, content: true },
    },
    200,
  );
});

app.route('/', contentApp);

export const miningInternalSupportTicketsRouter = app;
