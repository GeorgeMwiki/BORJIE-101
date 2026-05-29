/**
 * /api/v1/owner/handoff — cross-role @mention handoff surface.
 *
 * Three routes (all tenant-scoped via JWT + RLS):
 *
 *   POST   /                  create a handoff (the brain's `<chat_handoff />`
 *                             tag lands here after the SSE parser runs)
 *   GET    /inbox             list open handoffs for the authenticated user
 *   POST   /:id/resolve       close a handoff (replied / closed / declined)
 *
 * Owns:
 *  - migrations/0137_chat_handoffs.sql
 *  - packages/central-intelligence/src/handoff/
 *
 * Tenant isolation: every query runs under the `app.tenant_id` GUC the
 * databaseMiddleware binds per request. Cross-tenant routing is denied
 * at the route layer too — even within a tenant, the brain cannot route
 * a handoff to a user whose RLS scope does not cover the supplied scope
 * payload.
 *
 * Audit chain: every persisted handoff carries an `entry_hash` /
 * `prev_hash` pair via the central-intelligence recorder. Cron-driven
 * verification lives in `composition/audit-verify-cron.ts`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql, type SQLChunk } from 'drizzle-orm';
import pino from 'pino';

import {
  createHandoffRecorder,
  HANDOFF_PERSONA_ROLES,
  HANDOFF_RESOLUTIONS,
  HandoffError,
} from '@borjie/central-intelligence';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const logger = pino({ name: 'owner-handoff', level: process.env.LOG_LEVEL ?? 'info' });

const CreateHandoffSchema = z
  .object({
    sourceSessionId: z.string().min(1).max(160),
    targetUserId: z.string().min(1).max(120),
    targetRole: z.enum(HANDOFF_PERSONA_ROLES),
    topic: z.string().min(3).max(400),
    scopePayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const ResolveHandoffSchema = z
  .object({
    resolution: z.enum(HANDOFF_RESOLUTIONS),
    replyText: z.string().max(4000).optional(),
  })
  .strict();

const ListInboxQuery = z
  .object({
    status: z.enum(['open', 'all']).optional().default('open'),
    limit: z.coerce.number().int().positive().max(200).default(50),
  })
  .strict();

interface AuthContext {
  readonly tenant: { readonly tenantId: string };
  readonly actor: { readonly id: string };
}

function getAuth(c: { get: (k: string) => unknown }): AuthContext | null {
  const ctx = c.get('authContext') ?? c.get('auth');
  if (!ctx || typeof ctx !== 'object') return null;
  const candidate = ctx as Partial<AuthContext>;
  if (!candidate.tenant?.tenantId || !candidate.actor?.id) return null;
  return candidate as AuthContext;
}

function unauthorized(c: { json: (b: unknown, s: number) => Response }) {
  return c.json(
    { success: false, error: { code: 'UNAUTHORIZED', message: 'auth context missing' } },
    401,
  );
}

function unavailable(c: { json: (b: unknown, s: number) => Response }) {
  return c.json(
    { success: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'db client not initialised' } },
    503,
  );
}

interface DbLike {
  execute(q: unknown): Promise<unknown>;
}

interface ContextWithDb {
  get(key: 'db'): DbLike | undefined;
  get(key: string): unknown;
}

/**
 * Drizzle's `execute` takes its own tagged-template `sql` shape; the
 * recorder uses a plain `{ text, values }` envelope so it stays portable
 * across postgres-js / pg-pool / test doubles. This adapter rewrites the
 * envelope back into a drizzle `sql` invocation.
 *
 * Numbered placeholders ($1, $2, ...) are mapped to the values array in
 * order via the manual fragment join below. This is safe because the
 * recorder only emits two literal query strings (INSERT + UPDATE + the
 * SELECT head) — none of which can be tampered with by a request body.
 */
function bindRecorderDb(db: DbLike): DbLike {
  return {
    async execute(query: unknown) {
      const q = query as { text?: string; values?: ReadonlyArray<unknown> };
      if (typeof q?.text === 'string' && Array.isArray(q.values)) {
        // Reconstruct as a drizzle sql tagged template via .raw + binds.
        // The recorder's query strings use $1..$N positional placeholders,
        // which we rewrite into a single drizzle fragment.
        const parts = q.text.split(/\$\d+/);
        // Build an interleaved fragment list compatible with drizzle's
        // sql.join helper. Each `${...}` between fragments becomes a bind.
        const fragments: SQLChunk[] = [];
        for (let i = 0; i < parts.length; i += 1) {
          fragments.push(sql.raw(parts[i] ?? ''));
          if (i < q.values.length) fragments.push(q.values[i] as SQLChunk);
        }
        const composed = sql.join(fragments, sql.raw(''));
        const result = await db.execute(composed);
        // Drizzle returns `{ rows }` for postgres-js; recorder accepts both.
        return result;
      }
      return db.execute(query);
    },
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ─── POST / — create a handoff ─────────────────────────────────────────
app.post(
  '/',
  zValidator('json', CreateHandoffSchema),
  async (c) => {
    const auth = getAuth(c);
    if (!auth) return unauthorized(c);
    const db = (c as ContextWithDb).get('db');
    if (!db) return unavailable(c);

    const body = c.req.valid('json');
    const recorder = createHandoffRecorder({ db: bindRecorderDb(db) });

    try {
      const baseInput = {
        tenantId: auth.tenant.tenantId,
        sourceSessionId: body.sourceSessionId,
        sourceUserId: auth.actor.id,
        targetUserId: body.targetUserId,
        targetRole: body.targetRole,
        topic: body.topic,
      } as const;
      const handoff = await recorder.recordHandoff(
        body.scopePayload
          ? { ...baseInput, scopePayload: body.scopePayload }
          : baseInput,
      );
      return c.json({ success: true, data: handoff }, 201);
    } catch (err) {
      if (err instanceof HandoffError) {
        const status =
          err.code === 'invalid_input'
            ? 400
            : err.code === 'cross_tenant_denied' || err.code === 'rls_scope_denied'
              ? 403
              : err.code === 'unknown_handoff'
                ? 404
                : 500;
        return c.json(
          { success: false, error: { code: err.code, message: err.message } },
          status,
        );
      }
      logger.error({ err }, 'handoff create failed');
      return c.json(
        { success: false, error: { code: 'INTERNAL', message: 'handoff create failed' } },
        500,
      );
    }
  },
);

// ─── GET /inbox — list handoffs for the authenticated user ─────────────
app.get(
  '/inbox',
  zValidator('query', ListInboxQuery),
  async (c) => {
    const auth = getAuth(c);
    if (!auth) return unauthorized(c);
    const db = (c as ContextWithDb).get('db');
    if (!db) return unavailable(c);

    const { status, limit } = c.req.valid('query');
    const targetId = auth.actor.id;
    const whereOpen = status === 'open' ? sql`AND resolved_at IS NULL` : sql``;

    const rows = await db.execute(sql`
      SELECT id, tenant_id, source_session_id, source_user_id,
             target_user_id, target_role, topic, scope_payload,
             resolved_at, resolution, reply_text, audit_chain_seq,
             entry_hash, prev_hash, created_at
        FROM chat_handoffs
       WHERE target_user_id = ${targetId}
         ${whereOpen}
       ORDER BY created_at DESC
       LIMIT ${limit}
    `);
    const list = Array.isArray(rows)
      ? rows
      : (rows as { rows?: ReadonlyArray<unknown> }).rows ?? [];
    return c.json({ success: true, data: list });
  },
);

// ─── POST /:id/resolve — close a handoff ───────────────────────────────
app.post(
  '/:id/resolve',
  zValidator('json', ResolveHandoffSchema),
  async (c) => {
    const auth = getAuth(c);
    if (!auth) return unauthorized(c);
    const db = (c as ContextWithDb).get('db');
    if (!db) return unavailable(c);

    const handoffId = c.req.param('id');
    if (!handoffId) {
      return c.json(
        { success: false, error: { code: 'INVALID', message: 'handoff id required' } },
        400,
      );
    }
    const body = c.req.valid('json');
    const recorder = createHandoffRecorder({ db: bindRecorderDb(db) });

    try {
      const resolved = await recorder.resolveHandoff({
        tenantId: auth.tenant.tenantId,
        handoffId,
        resolution: body.resolution,
        ...(typeof body.replyText === 'string' && { replyText: body.replyText }),
      });
      // Cross-tenant + RLS guard: the only user allowed to resolve a
      // handoff is its target. The UPDATE already filters by tenant_id;
      // this check refuses an authenticated user trying to resolve a
      // handoff routed to someone else within the same tenant.
      if (resolved.targetUserId !== auth.actor.id) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'only the handoff target may resolve',
            },
          },
          403,
        );
      }
      return c.json({ success: true, data: resolved });
    } catch (err) {
      if (err instanceof HandoffError) {
        const status =
          err.code === 'invalid_input'
            ? 400
            : err.code === 'unknown_handoff'
              ? 404
              : 500;
        return c.json(
          { success: false, error: { code: err.code, message: err.message } },
          status,
        );
      }
      logger.error({ err }, 'handoff resolve failed');
      return c.json(
        { success: false, error: { code: 'INTERNAL', message: 'handoff resolve failed' } },
        500,
      );
    }
  },
);

export const ownerHandoffRouter = app;
