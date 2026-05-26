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

export const miningBuyersKycRouter = app;
