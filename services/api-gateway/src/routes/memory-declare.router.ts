// @ts-nocheck — Hono v4 status-code literal union widens c.json branches.

/**
 * Declared-facts producer — POST /api/v1/memory/declare.
 *
 * User-declared facts join the kernel's semantic memory with
 * `source: 'declared'`. Examples:
 *   - "My preferred language is Swahili"
 *   - "Always quote rent in USD on this account"
 *   - "Do not contact me before 9am"
 *
 * Declared facts outrank both extracted and consolidated facts at
 * step-4 memory recall. This is the user's explicit override channel.
 *
 * Auth required — tenantId + userId from the auth middleware.
 *
 * Closes the LITFIN parity gap: declared-fact producer (the only
 * user-facing path that writes into semantic memory directly).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createSemanticMemoryService } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { perUserRateLimit } from '../middleware/rate-limiter';
import { getDb } from '../composition/db-client';

import { withSecurityEvents } from '@borjie/observability';
const DeclareSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-zA-Z0-9_.\-:]+$/, {
      message:
        'key must be alphanumeric with `_`, `.`, `-`, `:` separators only',
    }),
  value: z.union([
    z.string().max(2_000),
    z.number(),
    z.boolean(),
    z.record(z.unknown()),
  ]),
  /**
   * Caller-provided confidence ∈ [0, 1]. Defaults to 0.95 — declared
   * facts are first-party and explicit; we do NOT default to 1.0
   * because a user can still mis-type their own preference.
   */
  confidence: z.number().min(0).max(1).default(0.95),
});

const ListSchema = z.object({
  prefix: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const DeleteSchema = z.object({
  key: z.string().min(1).max(120),
});

const router = new Hono();
router.use('*', authMiddleware);
// A2b-3 wire #5 — declared-facts is a producer endpoint and a natural
// target for abuse (memory amplification). Cap per-user churn at 30
// calls / 60s. Sits after authMiddleware so the bucket key is the
// authenticated (tenant, user) pair, not a coarse IP.
router.use('*', perUserRateLimit({ windowMs: 60_000, max: 30 }));

// POST /memory/declare — upsert one declared fact.
router.post('/declare', zValidator('json', DeclareSchema), withSecurityEvents({ action: 'memory-declare.create', resource: 'memory-declare', severity: 'info' }, async (c) => {
  const body = c.req.valid('json');
  const auth = c.get('auth') ?? {};
  const tenantId = auth.tenantId ?? null;
  const userId = auth.userId ?? auth.sub ?? null;

  if (!tenantId || !userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'declared facts require an authenticated tenant + user',
        },
      },
      401,
    );
  }

  const db = getDb();
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DECLARED_FACTS_UNAVAILABLE',
          message: 'declared-facts store is not configured (DATABASE_URL unset)',
        },
      },
      503,
    );
  }

  const svc = createSemanticMemoryService(db);
  try {
    await svc.upsertFact({
      tenantId,
      userId,
      key: body.key,
      value: body.value,
      confidence: body.confidence,
      source: 'declared',
      sourceTurnId: null,
    });
  } catch (err) {
    // A2b-3 wire #5 — cap-exceeded signal → HTTP 429.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'declared-facts-cap'
    ) {
      return c.json(
        {
          error: {
            code: 'declared-facts-cap',
            message: 'Maximum 500 declared facts per user.',
          },
        },
        429,
      );
    }
    return c.json(
      {
        success: false,
        error: {
          code: 'DECLARED_FACT_WRITE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      500,
    );
  }

  return c.json({
    success: true,
    key: body.key,
    source: 'declared',
  });
}));

// GET /memory/declare — list declared facts for the authed user.
router.get('/declare', zValidator('query', ListSchema), async (c) => {
  const { prefix, limit } = c.req.valid('query');
  const auth = c.get('auth') ?? {};
  const tenantId = auth.tenantId ?? null;
  const userId = auth.userId ?? auth.sub ?? null;

  if (!tenantId || !userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'declared facts require an authenticated tenant + user',
        },
      },
      401,
    );
  }

  const db = getDb();
  if (!db) {
    return c.json({ success: true, facts: [] });
  }

  const svc = createSemanticMemoryService(db);
  const rows = await svc.search({
    tenantId,
    userId,
    ...(prefix ? { prefix } : {}),
    limit,
  });
  const declared = rows.filter((r) => r.source === 'declared');
  return c.json({ success: true, facts: declared });
});

// DELETE /memory/declare — soft-delete (clears the value) one fact.
router.delete('/declare', zValidator('json', DeleteSchema), withSecurityEvents({ action: 'memory-declare.delete', resource: 'memory-declare', severity: 'notice' }, async (c) => {
  const { key } = c.req.valid('json');
  const auth = c.get('auth') ?? {};
  const tenantId = auth.tenantId ?? null;
  const userId = auth.userId ?? auth.sub ?? null;

  if (!tenantId || !userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'declared facts require an authenticated tenant + user',
        },
      },
      401,
    );
  }

  const db = getDb();
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DECLARED_FACTS_UNAVAILABLE',
          message: 'declared-facts store is not configured (DATABASE_URL unset)',
        },
      },
      503,
    );
  }

  // Soft-delete: write the same key with value=null + confidence=0.
  // The retriever surfaces non-null declared facts only.
  const svc = createSemanticMemoryService(db);
  try {
    await svc.upsertFact({
      tenantId,
      userId,
      key,
      value: null,
      confidence: 0,
      source: 'declared',
      sourceTurnId: null,
    });
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DECLARED_FACT_DELETE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      500,
    );
  }
  return c.json({ success: true, key });
}));

export default router;
