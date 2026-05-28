/**
 * /api/v1/owner/share-links - Share Links (Wave SUPERPOWERS).
 *
 * Backs the `mining.ui.share_view` chat superpower so Mr. Mwikila can
 * mint shareable / time-limited links on the owner's behalf, plus the
 * companion public resolver mounted at `/api/v1/public/share/:token`.
 *
 * Routes:
 *   POST   /                         create a share link (chat or UI)
 *   GET    /                         list active links for this owner
 *   DELETE /:id                      revoke a link (sets revoked_at)
 *
 * The public resolver is exported as `publicShareResolverRouter` and
 * mounted OUTSIDE the auth middleware in `services/api-gateway/src/index.ts`.
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware` (`app.tenant_id` GUC for RLS).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';

import { shareLinks, SHARE_PERMISSIONS, SHARE_ENTITY_TYPES } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-share-links');

// ─── Schemas ──────────────────────────────────────────────────────────

const createSchema = z.object({
  entityType: z.enum(SHARE_ENTITY_TYPES),
  entityId: z.string().min(1).max(120),
  recipients: z.array(z.string().email()).max(10).optional().default([]),
  expiresInHours: z.number().int().min(1).max(720).default(24),
  permission: z.enum(SHARE_PERMISSIONS).default('read'),
  reason: z.string().min(1).max(400).optional(),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
});

const listQuerySchema = z.object({
  entityType: z.enum(SHARE_ENTITY_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Helpers ──────────────────────────────────────────────────────────

const TOKEN_BYTES = 32; // 256-bit opaque token, base64url-encoded.

function generateToken(): string {
  return randomBytes(TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildShareUrl(token: string): string {
  // PUBLIC_BASE_URL is set per-env; fall back to a relative path so a
  // misconfigured env still produces a working same-origin URL.
  const base = process.env.PUBLIC_BASE_URL?.trim() ?? '';
  return base
    ? `${base.replace(/\/+$/, '')}/api/v1/public/share/${token}`
    : `/api/v1/public/share/${token}`;
}

// ─── Authenticated owner-side router ──────────────────────────────────

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// POST / - mint a new share link
app.post('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'SHARE_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid share-link payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const input = parsed.data;
  const token = generateToken();
  const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);

  try {
    const [row] = await db
      .insert(shareLinks)
      .values({
        tenantId: auth.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        token,
        permission: input.permission,
        expiresAt,
        createdById: auth.userId,
        recipients: input.recipients,
        provenance: input.provenance,
      })
      .returning();

    moduleLogger.info('owner-share-links: created', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      shareLinkId: row.id,
      entityType: input.entityType,
      entityId: input.entityId,
      recipientCount: input.recipients.length,
      expiresAt: expiresAt.toISOString(),
    });

    return c.json(
      {
        success: true,
        data: {
          shareLinkId: row.id,
          token: row.token,
          url: buildShareUrl(row.token),
          expiresAt: row.expiresAt.toISOString(),
          dispatched: input.recipients.length,
        },
      },
      201,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    moduleLogger.error('owner-share-links: insert failed', {
      tenantId: auth.tenantId,
      error: message,
    });
    return c.json(
      { success: false, error: { code: 'SHARE_INSERT_FAILED', message } },
      500,
    );
  }
});

// GET / - list active share links for this tenant
app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'SHARE_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }

  const parsed = listQuerySchema.safeParse({
    entityType: c.req.query('entityType'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', issues: parsed.error.issues } },
      400,
    );
  }

  const conditions = [
    eq(shareLinks.tenantId, auth.tenantId),
    isNull(shareLinks.revokedAt),
    gt(shareLinks.expiresAt, new Date()),
  ];
  if (parsed.data.entityType) {
    conditions.push(eq(shareLinks.entityType, parsed.data.entityType));
  }

  const rows = await db
    .select()
    .from(shareLinks)
    .where(and(...conditions))
    .orderBy(desc(shareLinks.createdAt))
    .limit(parsed.data.limit);

  return c.json({
    success: true,
    data: {
      shareLinks: rows.map((row: { token: string; [k: string]: unknown }) => ({
        ...row,
        url: buildShareUrl(row.token),
      })),
      count: rows.length,
    },
  });
});

// DELETE /:id - revoke a share link
app.delete('/:id', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  const id = c.req.param('id');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'SHARE_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }

  const [existing] = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.tenantId, auth.tenantId), eq(shareLinks.id, id)))
    .limit(1);
  if (!existing) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Share link not found' } }, 404);
  }
  if (existing.revokedAt) {
    return c.json(
      { success: false, error: { code: 'ALREADY_REVOKED', message: 'Share link is already revoked' } },
      409,
    );
  }

  const [row] = await db
    .update(shareLinks)
    .set({ revokedAt: new Date(), revokedById: auth.userId })
    .where(and(eq(shareLinks.tenantId, auth.tenantId), eq(shareLinks.id, id)))
    .returning();

  moduleLogger.info('owner-share-links: revoked', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    shareLinkId: id,
  });

  return c.json({ success: true, data: { shareLink: row } });
});

export const ownerShareLinksRouter = app;
export default ownerShareLinksRouter;

// ─── Public resolver (no auth) ────────────────────────────────────────
//
// Mounted under /api/v1/public/share by index.ts. Resolves an opaque
// token to the entity payload (read-only by default). The handler
// MUST NOT log the token in plain text; we log only the share link id
// + tenant_id when a match is found.

const publicApp = new Hono();
publicApp.use('*', databaseMiddleware);

publicApp.get('/:token', async (c: any) => {
  const db = c.get('db');
  const token = c.req.param('token');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'SHARE_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  if (!token || token.length < 16 || token.length > 80) {
    return c.json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Token malformed' } }, 400);
  }

  // No tenant filter here because the public resolver pre-dates the GUC.
  // Defence in depth: rely on the UNIQUE(token) index + downstream
  // entity-fetch path which DOES enforce tenant_id.
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).limit(1);
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Share link not found' } }, 404);
  }
  if (row.revokedAt) {
    return c.json({ success: false, error: { code: 'REVOKED', message: 'Share link revoked' } }, 410);
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return c.json({ success: false, error: { code: 'EXPIRED', message: 'Share link expired' } }, 410);
  }

  // Best-effort usage bump - non-blocking on failure.
  try {
    await db
      .update(shareLinks)
      .set({ usedCount: (row.usedCount ?? 0) + 1, lastUsedAt: new Date() })
      .where(eq(shareLinks.id, row.id));
  } catch (e) {
    moduleLogger.warn('owner-share-links: usage bump failed', {
      shareLinkId: row.id,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return c.json({
    success: true,
    data: {
      entityType: row.entityType,
      entityId: row.entityId,
      permission: row.permission,
      expiresAt: new Date(row.expiresAt).toISOString(),
    },
  });
});

export const publicShareResolverRouter = publicApp;
