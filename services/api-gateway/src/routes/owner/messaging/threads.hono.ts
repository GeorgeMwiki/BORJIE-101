/**
 * /api/v1/owner/threads (migration 0107).
 *
 * Owner-to-owner messaging. The endpoint is mounted at /owner/threads
 * so the surface URL family stays cleanly grouped: /owner/threads,
 * /owner/threads/:id, /owner/threads/:id/messages, /owner/messages/:id/read.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST   /                              start a thread (recipient by NIDA / TIN / BRELA)
 *   GET    /                              inbox
 *   POST   /:id/messages                  send a message
 *   PATCH  /messages/:msgId/read          mark a message as read
 *
 * The chat-as-OS brain reads / writes via brain tools
 * `owner.messaging.send_to`, `unread_count`, `thread_list` — both
 * surfaces hit the identical backend.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { authMiddleware } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { withSecurityEvents } from '@borjie/observability';

const StartThreadSchema = z
  .object({
    subject: z.string().min(1).max(255),
    bodyMd: z.string().min(1).max(20_000),
    attachments: z.array(z.record(z.unknown())).max(20).default([]),
    recipientOwnerId: z.string().uuid().optional(),
    recipientNida: z.string().min(8).max(32).optional(),
    recipientTin: z.string().min(8).max(32).optional(),
    recipientBrelaNo: z.string().min(4).max(64).optional(),
  })
  .refine(
    (v) =>
      Boolean(
        v.recipientOwnerId ||
          v.recipientNida ||
          v.recipientTin ||
          v.recipientBrelaNo,
      ),
    {
      message:
        'one of recipientOwnerId / recipientNida / recipientTin / recipientBrelaNo required',
    },
  );

const SendMessageSchema = z.object({
  bodyMd: z.string().min(1).max(20_000),
  attachments: z.array(z.record(z.unknown())).max(20).default([]),
});

const ListInboxQuery = z.object({
  status: z.enum(['open', 'closed', 'archived']).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

function provenance(actorId: string, source: 'web' | 'mobile' | 'chat'): string {
  return JSON.stringify({
    actorId,
    capturedAt: new Date().toISOString(),
    source,
    via: source === 'chat' ? 'chat' : source === 'mobile' ? 'form' : 'api',
  });
}

function auditHash(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function unavailable(c: { json: (b: unknown, s: number) => Response }) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database client is not initialized',
      },
    },
    503,
  );
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

/**
 * Resolve a recipient ownerId from one of NIDA / TIN / BRELA. Uses the
 * `external_parties` table as the cross-tenant lookup surface — the
 * owner-identity service is the SoR for owner identities and would
 * be queried here in a fuller implementation; for now we accept the
 * ownerId directly when provided and degrade to a best-effort lookup
 * otherwise.
 */
async function resolveRecipientOwnerId(
  db: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
  args: {
    recipientOwnerId?: string;
    recipientNida?: string;
    recipientTin?: string;
    recipientBrelaNo?: string;
  },
): Promise<string | null> {
  if (args.recipientOwnerId) return args.recipientOwnerId;
  if (args.recipientTin) {
    const rows = await db.execute(sql`
      SELECT id FROM external_parties WHERE tin = ${args.recipientTin} LIMIT 1
    `);
    const row = (rows as unknown as Record<string, unknown>[])[0];
    if (row?.id) return String(row.id);
  }
  if (args.recipientBrelaNo) {
    const rows = await db.execute(sql`
      SELECT id FROM external_parties WHERE brela_no = ${args.recipientBrelaNo} LIMIT 1
    `);
    const row = (rows as unknown as Record<string, unknown>[])[0];
    if (row?.id) return String(row.id);
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST / - start a thread
// ---------------------------------------------------------------------------

app.post(
  '/',
  zValidator('json', StartThreadSchema),
  withSecurityEvents(
    {
      action: 'owner.messaging.thread_start',
      resource: 'owner.thread',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const body = c.req.valid('json');
      const recipientOwnerId = await resolveRecipientOwnerId(db, body);
      if (!recipientOwnerId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'RECIPIENT_NOT_FOUND',
              message:
                'could not resolve recipient via NIDA / TIN / BRELA or ownerId',
            },
          },
          404,
        );
      }

      const threadId = randomUUID();
      const messageId = randomUUID();
      const now = new Date().toISOString();
      const threadProv = provenance(auth.userId, 'web');
      const threadHash = auditHash({
        threadId,
        tenantId: auth.tenantId,
        subject: body.subject,
        recipientOwnerId,
      });
      const messageHash = auditHash({
        messageId,
        threadId,
        senderId: auth.userId,
        bodyDigest: createHash('sha256').update(body.bodyMd).digest('hex'),
      });

      await db.execute(sql`
        INSERT INTO owner_threads (
          id, tenant_id, subject, status, created_by_id,
          last_activity_at, provenance, audit_hash_id
        ) VALUES (
          ${threadId}, ${auth.tenantId}::uuid, ${body.subject}, 'open',
          ${auth.userId}::uuid, ${now}::timestamptz,
          ${threadProv}::jsonb, ${threadHash}
        )
      `);
      await db.execute(sql`
        INSERT INTO owner_thread_participants (
          thread_id, tenant_id, owner_id, role
        ) VALUES
          (${threadId}, ${auth.tenantId}::uuid, ${auth.userId}::uuid, 'initiator'),
          (${threadId}, ${auth.tenantId}::uuid, ${recipientOwnerId}::uuid, 'recipient')
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO owner_messages (
          id, thread_id, tenant_id, sender_id, body_md,
          attachments, sent_at, read_by, provenance, audit_hash_id
        ) VALUES (
          ${messageId}, ${threadId}, ${auth.tenantId}::uuid,
          ${auth.userId}::uuid, ${body.bodyMd},
          ${JSON.stringify(body.attachments)}::jsonb,
          ${now}::timestamptz, '{}'::jsonb,
          ${threadProv}::jsonb, ${messageHash}
        )
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM owner_threads
         WHERE id = ${threadId}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const thread = (
        fetched as unknown as Record<string, unknown>[]
      )[0];
      return c.json(
        { success: true, data: { thread, firstMessageId: messageId } },
        201,
      );
    },
  ),
);

// ---------------------------------------------------------------------------
// GET / - inbox
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const parsed = ListInboxQuery.safeParse({
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: parsed.error.message },
      },
      400,
    );
  }
  const { status, limit } = parsed.data;
  const whereStatus = status ? sql`AND status = ${status}` : sql``;
  const rows = await db.execute(sql`
    SELECT t.*
      FROM owner_threads t
      JOIN owner_thread_participants p
        ON p.thread_id = t.id AND p.owner_id = ${auth.userId}::uuid
     WHERE t.tenant_id = ${auth.tenantId}::uuid
       ${whereStatus}
     ORDER BY t.last_activity_at DESC
     LIMIT ${limit}
  `);
  return c.json({
    success: true,
    data: (rows as unknown as Record<string, unknown>[]) ?? [],
  });
});

// ---------------------------------------------------------------------------
// POST /:id/messages - send a message
// ---------------------------------------------------------------------------

app.post(
  '/:id/messages',
  zValidator('json', SendMessageSchema),
  withSecurityEvents(
    {
      action: 'owner.messaging.send',
      resource: 'owner.message',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const threadId = c.req.param('id');
      const body = c.req.valid('json');

      const threadRows = await db.execute(sql`
        SELECT id FROM owner_threads
         WHERE id = ${threadId}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const thread = (
        threadRows as unknown as Record<string, unknown>[]
      )[0];
      if (!thread) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'thread not found' },
          },
          404,
        );
      }

      const messageId = randomUUID();
      const now = new Date().toISOString();
      const prov = provenance(auth.userId, 'web');
      const hash = auditHash({
        messageId,
        threadId,
        senderId: auth.userId,
        bodyDigest: createHash('sha256').update(body.bodyMd).digest('hex'),
      });

      await db.execute(sql`
        INSERT INTO owner_messages (
          id, thread_id, tenant_id, sender_id, body_md,
          attachments, sent_at, read_by, provenance, audit_hash_id
        ) VALUES (
          ${messageId}, ${threadId}::uuid, ${auth.tenantId}::uuid,
          ${auth.userId}::uuid, ${body.bodyMd},
          ${JSON.stringify(body.attachments)}::jsonb,
          ${now}::timestamptz, '{}'::jsonb,
          ${prov}::jsonb, ${hash}
        )
      `);
      await db.execute(sql`
        UPDATE owner_threads
           SET last_activity_at = ${now}::timestamptz
         WHERE id = ${threadId}::uuid AND tenant_id = ${auth.tenantId}::uuid
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM owner_messages
         WHERE id = ${messageId}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// PATCH /messages/:msgId/read - mark read
// ---------------------------------------------------------------------------

app.patch(
  '/messages/:msgId/read',
  withSecurityEvents(
    {
      action: 'owner.messaging.read',
      resource: 'owner.message',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const msgId = c.req.param('msgId');
      const readAt = new Date().toISOString();

      const result = await db.execute(sql`
        UPDATE owner_messages
           SET read_by = jsonb_set(
                 COALESCE(read_by, '{}'::jsonb),
                 ARRAY[${auth.userId}::text],
                 to_jsonb(${readAt}::text),
                 true
               )
         WHERE id = ${msgId}::uuid AND tenant_id = ${auth.tenantId}::uuid
         RETURNING id
      `);
      const row = (result as unknown as Record<string, unknown>[])[0];
      if (!row) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'message not found' },
          },
          404,
        );
      }
      return c.json({ success: true, data: { id: msgId, readAt } });
    },
  ),
);

export const ownerThreadsRouter = app;
