/**
 * /api/v1/mining/buyers — KYC for mineral counterparties.
 *
 * Routes:
 *   POST  /kyc                NIDA + TIN + AML submission
 *   GET   /kyc/:id/status     poll current verification status
 *
 * Real provider calls (NIDA, TIN registry, sanctions screening) sit in
 * `@borjie/compliance-plugins`; this route persists the buyer record
 * and surfaces the kyc_status the back-office service writes back.
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { buyers } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  buyersKycSubmitRoute,
  buyersKycStatusRoute,
} from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(
  buyersKycSubmitRoute,
  withSecurityEvents(
    { action: 'mining.buyer.kyc.submit', resource: 'mining.buyer', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const kycStatus =
        input.amlScreenResult === 'flagged'
          ? 'rejected'
          : input.nidaId && input.tin && input.amlScreenResult === 'clear'
            ? 'verified'
            : 'in_review';

      // Idempotency: one buyer per (tenant, user). If the caller already
      // has a row, refuse to create a duplicate. They should hit the
      // status endpoint or contact support to amend.
      const [existing] = await db
        .select({ id: buyers.id })
        .from(buyers)
        .where(and(eq(buyers.tenantId, tenantId), eq(buyers.linkedUserId, userId)))
        .limit(1);
      if (existing) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'KYC_ALREADY_SUBMITTED',
              message: 'A buyer record already exists for this user',
            },
            buyerId: existing.id,
          },
          409,
        );
      }

      const [row] = await db
        .insert(buyers)
        .values({
          id: randomUUID(),
          tenantId,
          name: input.name,
          companyId: input.companyId ?? null,
          kind: input.kind,
          country: input.country,
          licenceNumber: input.licenceNumber ?? null,
          contactName: input.contactName ?? null,
          contactEmail: input.contactEmail ?? null,
          contactPhone: input.contactPhone ?? null,
          kycStatus,
          linkedUserId: userId,
          attributes: {
            nidaId: input.nidaId ?? null,
            tin: input.tin ?? null,
            amlScreenResult: input.amlScreenResult,
            submittedAt: new Date().toISOString(),
          },
          createdAt: new Date(),
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(buyersKycStatusRoute, async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const { id } = c.req.valid('param');
  const [row] = await db
    .select()
    .from(buyers)
    .where(and(eq(buyers.id, id), eq(buyers.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'Buyer not found' },
      },
      404,
    );
  }
  return c.json(
    {
      success: true as const,
      data: {
        id: row.id,
        kycStatus: row.kycStatus,
        kind: row.kind,
        country: row.country,
        updatedAt: row.createdAt,
        attributes: row.attributes,
      },
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /kyc/upload-atom — chunked KYC document upload.
//
// Persists each chunk into the buyer row's attributes.kycChunks array so
// the assembly job downstream can stitch them back together. Marks
// `assembled: true` on the response when the caller sends `isLast: true`.
// Tenant-scoped via RLS + auth.tenantId predicate.
// ---------------------------------------------------------------------------

const UploadAtomBodySchema = z.object({
  sessionId: z.string().min(1).max(120),
  chunkIndex: z.number().int().nonnegative().max(10_000),
  chunkBase64: z.string().min(1).max(2_000_000),
  isLast: z.boolean().default(false),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/kyc/upload-atom', async (c: any) => {
  const auth = c.get('auth') as
    | { tenantId?: string; userId?: string }
    | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      },
      401,
    );
  }
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }
  const body = (await c.req.json().catch(() => null)) as unknown;
  const parsed = UploadAtomBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
      },
      400,
    );
  }

  const [buyer] = await db
    .select()
    .from(buyers)
    .where(
      and(
        eq(buyers.tenantId, auth.tenantId),
        eq(buyers.linkedUserId, auth.userId),
      ),
    )
    .limit(1);
  if (!buyer) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'NO_KYC_ON_FILE',
          message: 'Submit KYC at /api/v1/mining/buyers/kyc first',
        },
      },
      404,
    );
  }

  // Accumulate chunks under attributes.kycChunks. Immutability: build a
  // NEW chunks list each insert; never mutate the prior array.
  const prior = (buyer.attributes as Record<string, unknown>) ?? {};
  const priorChunks = Array.isArray(prior.kycChunks)
    ? (prior.kycChunks as Array<{
        sessionId: string;
        chunkIndex: number;
        receivedAt: string;
        size: number;
      }>)
    : [];
  // Drop any prior entry for the same (sessionId, chunkIndex) so retries
  // are idempotent.
  const dedupedChunks = priorChunks.filter(
    (c) =>
      !(
        c.sessionId === parsed.data.sessionId &&
        c.chunkIndex === parsed.data.chunkIndex
      ),
  );
  const nextChunks = [
    ...dedupedChunks,
    {
      sessionId: parsed.data.sessionId,
      chunkIndex: parsed.data.chunkIndex,
      receivedAt: new Date().toISOString(),
      size: parsed.data.chunkBase64.length,
    },
  ];
  const assembled = parsed.data.isLast;
  await db
    .update(buyers)
    .set({
      attributes: {
        ...prior,
        kycChunks: nextChunks,
        kycChunksAssembled: assembled,
      },
    })
    .where(
      and(eq(buyers.id, buyer.id), eq(buyers.tenantId, auth.tenantId)),
    );

  return c.json(
    {
      success: true as const,
      data: {
        sessionId: parsed.data.sessionId,
        chunkIndex: parsed.data.chunkIndex,
        acceptedAt: new Date().toISOString(),
        assembled,
      },
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// GET /kyc/me — auto-resolve KYC status for the calling user.
//
// Backs the buyer persona-tool `mining.buyers.kyc.status` which does not
// carry an explicit buyer id (the brain knows the actor, not the buyer
// row id). Returns 404 when the calling user has not submitted KYC yet
// so the FE can route the buyer through /kyc.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/kyc/me', async (c: any) => {
  const auth = c.get('auth') as
    | { tenantId?: string; userId?: string }
    | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false as const,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      },
      401,
    );
  }
  const db = c.get('db');
  if (!db) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database not configured',
        },
      },
      503,
    );
  }
  const [row] = await db
    .select()
    .from(buyers)
    .where(
      and(
        eq(buyers.tenantId, auth.tenantId),
        eq(buyers.linkedUserId, auth.userId),
      ),
    )
    .limit(1);
  if (!row) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'NO_KYC_ON_FILE',
          message: 'Submit KYC at /api/v1/mining/buyers/kyc first',
        },
      },
      404,
    );
  }
  return c.json(
    {
      success: true as const,
      data: {
        id: row.id,
        kycStatus: row.kycStatus,
        kind: row.kind,
        country: row.country,
        updatedAt: row.createdAt,
        attributes: row.attributes,
      },
    },
    200,
  );
});

export const miningBuyersKycRouter = app;
