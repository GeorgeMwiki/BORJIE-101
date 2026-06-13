/**
 * /api/v1/mining/internal/self-healing — the INTERNAL-ADMIN self-healing
 * console. Every UI/wiring blocker the MAPE-K loop processes lands in
 * `self_healing_proposals` (migration 0349); this surface lets the Borjie
 * PLATFORM team triage it — read the queue (with insight + action plan),
 * approve a code-gated repair, or deny it (accept the degrade).
 *
 * The OWNER never reaches here: the table is platform-internal + service-role-
 * only, so all access runs via `withServiceRoleContext` inside the store, and
 * the route itself is SUPER_ADMIN/ADMIN-gated.
 *
 * Routes:
 *   GET   /proposals                 open queue (pending + auto-healed)
 *   POST  /proposals/:id/approve     approve a proposal (fix accepted)
 *   POST  /proposals/:id/deny        deny a proposal (degrade accepted)
 *
 * Mounted at `/api/v1/mining/internal/self-healing`.
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { UserRole } from '../../../types/user-role';
import { getDb } from '../../../composition/db-client';
import {
  createSelfHealingStore,
  type SelfHealingStore,
  type SelfHealingProposalRow,
} from '../../../composition/portal-genui/self-healing-store';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT));

/** Build the service-role store from the singleton pool, or null in degraded mode. */
function resolveStore(): SelfHealingStore | null {
  const db = getDb();
  if (!db) return null;
  return createSelfHealingStore({
    db: db as unknown as Parameters<typeof createSelfHealingStore>[0]['db'],
  });
}

const dbUnavailable = (c: Context) =>
  c.json(
    {
      success: false as const,
      error: {
        code: 'SELF_HEALING_DB_UNAVAILABLE',
        message: 'Database not configured',
      },
    },
    503,
  );

/** Serialize a row for the console (dates → ISO; needsApproval convenience). */
function toView(row: SelfHealingProposalRow) {
  const iso = (d: Date | string | null): string | null =>
    d == null ? null : d instanceof Date ? d.toISOString() : String(d);
  return {
    id: row.id,
    blockerKind: row.blockerKind,
    repairClass: row.repairClass,
    locus: row.locus,
    detail: row.detail,
    title: row.title,
    suggestedFix: row.suggestedFix,
    insight: row.insight,
    actionPlan: Array.isArray(row.actionPlan) ? row.actionPlan : [],
    autoApplicable: row.autoApplicable,
    tenantId: row.tenantId,
    occurrenceCount: row.occurrenceCount,
    status: row.status,
    // `pending` is the only status that needs a human decision; `auto-healed`
    // is an observation (the customer was already served).
    needsApproval: row.status === 'pending',
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
  };
}

app.get('/proposals', async (c) => {
  const store = resolveStore();
  if (!store) return dbUnavailable(c);
  const limitRaw = Number(c.req.query('limit') ?? '100');
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
  const rows = await store.listOpen(limit);
  return c.json({ success: true as const, data: rows.map(toView) }, 200);
});

const decideBodySchema = z.object({ note: z.string().max(2000).optional() });

function decideHandler(decision: 'approved' | 'denied') {
  return async (c: Context) => {
    const store = resolveStore();
    if (!store) return dbUnavailable(c);
    const auth = c.get('auth') as { userId: string } | undefined;
    if (!auth?.userId) {
      return c.json(
        {
          success: false as const,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        },
        401,
      );
    }
    const id = c.req.param('id');
    if (!id) {
      return c.json(
        {
          success: false as const,
          error: { code: 'VALIDATION_ERROR', message: 'Missing proposal id' },
        },
        400,
      );
    }
    const raw = await c.req.json().catch(() => ({}));
    const parsed = decideBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid decision payload',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const result = await store.decide({
      id,
      decision,
      actorId: auth.userId,
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    });
    if (!result.updated) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'NOT_FOUND',
            message: 'Proposal not found or already decided',
          },
        },
        404,
      );
    }
    return c.json({ success: true as const, data: { id, status: decision } }, 200);
  };
}

app.post('/proposals/:id/approve', decideHandler('approved'));
app.post('/proposals/:id/deny', decideHandler('denied'));

export const miningInternalSelfHealingRouter = app;
