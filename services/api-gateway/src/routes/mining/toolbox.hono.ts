/**
 * /api/v1/mining/toolbox-talks — pre-shift safety briefings.
 *
 * Backs the workforce-mobile "Safety pulse" section + the manager-side
 * schedule flow from Docs/research/worker-guidance-sota.md §9.
 *
 * Routes:
 *   GET   /             list talks for a site/date (default: today)
 *   POST  /             schedule a talk (manager-only)
 *   POST  /:id/acknowledge   worker fingerprint sign-off (idempotent)
 *
 * Tenant-isolation: RLS (migration 0080) auto-filters on the
 * `app.current_tenant_id` GUC. Handlers also predicate on `auth.tenantId`
 * so cross-tenant writes fail at the WITH CHECK predicate.
 *
 * Bilingual fields: `topicSw` is required, `topicEn` optional. Briefing
 * notes are Swahili-first per CLAUDE.md.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { miningToolboxTalks } from '@borjie/database';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-toolbox-talks');

const MANAGER_ROLES = [
  UserRole.TENANT_ADMIN,
  UserRole.PROPERTY_MANAGER,
  UserRole.SUPER_ADMIN,
] as const;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ListQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  date: z
    .union([
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      z.literal('today'),
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const CreateTalkSchema = z.object({
  siteId: z.string().uuid(),
  topicSw: z.string().min(1).max(500),
  topicEn: z.string().min(1).max(500).nullish(),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ledByUserId: z.string().uuid().nullish(),
  briefingNotesSw: z.string().max(10000).nullish(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
) {
  return { status, body: { success: false as const, error: { code, message } } };
}

function isoToday(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dedupeUserIds(ids: ReadonlyArray<string>): string[] {
  // Immutability: build a NEW array; never mutate the input.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createMiningToolboxRouter(): Hono {
  const app = new Hono();

  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // -------------------------------------------------------------------------
  // GET / — list talks (siteId, date filter — default today)
  // -------------------------------------------------------------------------
  app.get('/', zValidator('query', ListQuerySchema), async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'TOOLBOX_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    const q = c.req.valid('query');
    const limit = Math.min(q.limit ?? 100, 500);
    const conds = [eq(miningToolboxTalks.tenantId, tenantId)];
    if (q.siteId) {
      conds.push(eq(miningToolboxTalks.siteId, q.siteId));
    }
    const dateFilter = q.date === 'today' ? isoToday() : q.date;
    if (dateFilter) {
      conds.push(eq(miningToolboxTalks.scheduledFor, dateFilter));
    }

    try {
      const rows = await db
        .select()
        .from(miningToolboxTalks)
        .where(and(...conds))
        .orderBy(desc(miningToolboxTalks.scheduledFor))
        .limit(limit);
      return c.json({ success: true as const, data: rows }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      moduleLogger.error('toolbox talks list failed', {
        evt: 'toolbox_talks_list_failed',
        tenantId,
        reason: message,
      });
      const e = jsonError('TOOLBOX_LIST_FAILED', message, 500);
      return c.json(e.body, e.status);
    }
  });

  // -------------------------------------------------------------------------
  // POST / — schedule a talk (manager-only)
  // -------------------------------------------------------------------------
  app.post(
    '/',
    requireRole(...MANAGER_ROLES),
    zValidator('json', CreateTalkSchema),
    async (c: any) => {
      const { tenantId, userId } = c.get('auth') ?? {};
      if (!tenantId || !userId) {
        const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
        return c.json(err.body, err.status);
      }
      const db = c.get('db');
      if (!db) {
        const err = jsonError(
          'TOOLBOX_UNAVAILABLE',
          'database is not configured on this gateway',
          503,
        );
        return c.json(err.body, err.status);
      }

      const input = c.req.valid('json');
      try {
        const [row] = await db
          .insert(miningToolboxTalks)
          .values({
            tenantId,
            siteId: input.siteId,
            topicSw: input.topicSw,
            topicEn: input.topicEn ?? null,
            scheduledFor: input.scheduledFor,
            ledByUserId: input.ledByUserId ?? userId,
            acknowledgedByUserIds: [],
            briefingNotesSw: input.briefingNotesSw ?? null,
          })
          .returning();
        return c.json({ success: true as const, data: row }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'create failed';
        moduleLogger.error('toolbox talk create failed', {
          evt: 'toolbox_talk_create_failed',
          tenantId,
          reason: message,
        });
        const e = jsonError('TOOLBOX_CREATE_FAILED', message, 500);
        return c.json(e.body, e.status);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /:id/acknowledge — worker signs off (idempotent on already-acked)
  // -------------------------------------------------------------------------
  app.post('/:id/acknowledge', async (c: any) => {
    const { tenantId, userId } = c.get('auth') ?? {};
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'TOOLBOX_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    const id = c.req.param('id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      const err = jsonError('INVALID_TALK_ID', 'talk id must be a UUID', 400);
      return c.json(err.body, err.status);
    }

    try {
      const [existing] = await db
        .select()
        .from(miningToolboxTalks)
        .where(
          and(
            eq(miningToolboxTalks.id, id),
            eq(miningToolboxTalks.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!existing) {
        const err = jsonError('TALK_NOT_FOUND', 'Toolbox talk not found', 404);
        return c.json(err.body, err.status);
      }

      const current: ReadonlyArray<string> = Array.isArray(
        existing.acknowledgedByUserIds,
      )
        ? (existing.acknowledgedByUserIds as ReadonlyArray<string>)
        : [];

      if (current.includes(userId)) {
        // Idempotent — caller already signed off. Return current row with
        // a meta flag so optimistic-sync mobile clients can short-circuit.
        return c.json(
          {
            success: true as const,
            data: existing,
            meta: { idempotent: true as const },
          },
          200,
        );
      }

      // Immutability: build a NEW array; never mutate the existing one.
      const next = dedupeUserIds([...current, userId]);
      const [row] = await db
        .update(miningToolboxTalks)
        .set({ acknowledgedByUserIds: next })
        .where(
          and(
            eq(miningToolboxTalks.id, id),
            eq(miningToolboxTalks.tenantId, tenantId),
          ),
        )
        .returning();
      return c.json({ success: true as const, data: row }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'acknowledge failed';
      moduleLogger.error('toolbox talk acknowledge failed', {
        evt: 'toolbox_talk_acknowledge_failed',
        tenantId,
        talkId: id,
        reason: message,
      });
      const e = jsonError('TOOLBOX_ACK_FAILED', message, 500);
      return c.json(e.body, e.status);
    }
  });

  return app;
}

export const miningToolboxRouter = createMiningToolboxRouter();
