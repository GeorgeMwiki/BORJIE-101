/**
 * /api/v1/mining/internal/support/tickets — HQ support-queue list.
 *
 * SUPER_ADMIN / ADMIN only. The "ticket" surface inside Borjie HQ is
 * the union of:
 *   - unresolved `compliance_escalations` rows (Compliance Agent fan-in
 *     → operator review queue). These are the canonical "things
 *     a human operator must triage" today.
 *
 * The list-shape is intentionally a thin projection so the admin-web
 * `support` page can render a table + `TicketAck` per row without
 * teaching the FE a different SLA model than the compliance-queue
 * page already uses.
 *
 * When a dedicated `support_tickets` table lands (multi-channel email
 * / chat / webhook), this route can fan-in another data source by
 * appending to the projection.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { desc, isNull } from 'drizzle-orm';
import { complianceEscalations } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

interface SupportTicketRow {
  readonly id: string;
  readonly tenantId: string | null;
  readonly source: 'compliance-escalation';
  readonly severity: string;
  readonly summary: string;
  readonly openedAt: string;
  readonly ackedAt: string | null;
}

app.get('/', async (c) => {
  const db = c.get('db') as {
    select: () => {
      from: (t: unknown) => {
        where: (cond: unknown) => {
          orderBy: (
            ...cols: unknown[]
          ) => {
            limit: (
              n: number,
            ) => Promise<readonly Record<string, unknown>[]>;
          };
        };
      };
    };
  };
  const rows = await db
    .select()
    .from(complianceEscalations)
    .where(isNull(complianceEscalations.resolvedAt))
    .orderBy(desc(complianceEscalations.escalatedAt))
    .limit(200);

  const data: readonly SupportTicketRow[] = rows.map((row) => ({
    id: String(row['id']),
    tenantId: row['tenantId'] != null ? String(row['tenantId']) : null,
    source: 'compliance-escalation' as const,
    severity: String(row['severity'] ?? 'medium'),
    summary: String(row['summary'] ?? ''),
    openedAt:
      row['escalatedAt'] instanceof Date
        ? row['escalatedAt'].toISOString()
        : String(row['escalatedAt'] ?? new Date(0).toISOString()),
    ackedAt: null,
  }));

  return c.json(
    {
      success: true as const,
      data,
      meta: { count: data.length, source: 'compliance_escalations' as const },
    },
    200,
  );
});

export const miningInternalSupportTicketsRouter = app;
