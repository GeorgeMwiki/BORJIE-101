// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
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
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { buyers } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const KindEnum = z.enum(['trader', 'smelter', 'refinery', 'export_buyer', 'bot', 'broker']);

const SubmitKycSchema = z.object({
  name: z.string().min(1).max(200),
  kind: KindEnum,
  country: z.string().length(2).default('TZ'),
  companyId: z.string().optional(),
  licenceNumber: z.string().max(200).optional(),
  nidaId: z.string().min(6).max(40).optional(),
  tin: z.string().min(6).max(40).optional(),
  amlScreenResult: z.enum(['clear', 'flagged', 'pending']).default('pending'),
  contactName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(40).optional(),
});

app.post(
  '/kyc',
  zValidator('json', SubmitKycSchema),
  withSecurityEvents(
    { action: 'mining.buyer.kyc.submit', resource: 'mining.buyer', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const kycStatus = input.amlScreenResult === 'flagged'
        ? 'rejected'
        : (input.nidaId && input.tin && input.amlScreenResult === 'clear')
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
            success: false,
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
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

app.get('/kyc/:id/status', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  const [row] = await db
    .select()
    .from(buyers)
    .where(and(eq(buyers.id, id), eq(buyers.tenantId, tenantId)))
    .limit(1);
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Buyer not found' } }, 404);
  }
  return c.json({
    success: true,
    data: {
      id: row.id,
      kycStatus: row.kycStatus,
      kind: row.kind,
      country: row.country,
      updatedAt: row.createdAt,
      attributes: row.attributes,
    },
  });
});

export const miningBuyersKycRouter = app;
