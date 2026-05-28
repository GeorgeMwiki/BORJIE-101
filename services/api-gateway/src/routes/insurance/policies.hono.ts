/**
 * /api/v1/insurance/policies (migration 0106).
 *
 * Bind a quote into an active policy, list active policies, and cancel
 * (with reason). The renewal countdown surfaced in the owner-web
 * /insurance/page.tsx is computed off `expires_at - now()` so we don't
 * need a separate "renewals" endpoint — clients filter by status=active
 * and sort by expires_at.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST   /policies/bind          bind a quote
 *   GET    /policies               list (status filter)
 *   PATCH  /policies/:id/cancel    cancel with reason
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { withSecurityEvents } from '@borjie/observability';
import { selectInsuranceBrokerProvider } from '../../services/insurance-broker';

const BindSchema = z.object({
  quoteId: z.string().uuid(),
  paymentRef: z.string().min(1).max(128),
  effectiveAt: z.string().datetime(),
  termMonths: z.coerce.number().int().positive().max(60).default(12),
  evidenceDocId: z.string().uuid().optional(),
});

const ListQuerySchema = z.object({
  status: z.enum(['active', 'cancelled', 'expired', 'lapsed']).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const CancelSchema = z.object({
  reason: z.string().min(1).max(2000),
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

// ---------------------------------------------------------------------------
// POST /policies/bind - bind a quote
// ---------------------------------------------------------------------------

app.post(
  '/policies/bind',
  zValidator('json', BindSchema),
  withSecurityEvents(
    {
      action: 'insurance.policy.bind',
      resource: 'insurance.policy',
      severity: 'warning',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const body = c.req.valid('json');

      const quoteRows = await db.execute(sql`
        SELECT id, broker_party_id, provider_id, coverage_type,
               sum_insured_tzs, premium_tzs, deductible_tzs,
               exclusions, status, valid_until
          FROM insurance_quotes
         WHERE id = ${body.quoteId}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const quote = (
        quoteRows as unknown as Record<string, unknown>[]
      )[0];
      if (!quote) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'quote not found' },
          },
          404,
        );
      }
      if (quote.status !== 'open') {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_STATE',
              message: `quote.status=${String(quote.status)}, expected 'open'`,
            },
          },
          409,
        );
      }
      if (new Date(String(quote.valid_until)).getTime() < Date.now()) {
        return c.json(
          {
            success: false,
            error: { code: 'QUOTE_EXPIRED', message: 'quote has expired' },
          },
          410,
        );
      }

      const effectiveAt = new Date(body.effectiveAt);
      const expiresAt = new Date(effectiveAt);
      expiresAt.setMonth(expiresAt.getMonth() + body.termMonths);

      const broker = selectInsuranceBrokerProvider(process.env);
      const bound = await broker.bindPolicy({
        providerId: String(quote.provider_id),
        providerQuoteRef: String(quote.id),
        paymentRef: body.paymentRef,
        coverageType: String(quote.coverage_type) as never,
        sumInsuredTzs: Number(quote.sum_insured_tzs),
        premiumTzs: Number(quote.premium_tzs),
        deductibleTzs: Number(quote.deductible_tzs),
        effectiveAtIso: effectiveAt.toISOString(),
        expiresAtIso: expiresAt.toISOString(),
      });

      const id = randomUUID();
      const prov = provenance(auth.userId, 'web');
      const hash = auditHash({
        id,
        tenantId: auth.tenantId,
        policyNo: bound.policyNo,
        quoteId: body.quoteId,
      });

      await db.execute(sql`
        INSERT INTO insurance_policies (
          id, tenant_id, broker_party_id, provider_id, quote_id,
          policy_no, coverage_type, sum_insured_tzs, premium_tzs,
          deductible_tzs, exclusions, effective_at, expires_at,
          status, evidence_doc_id, provenance, audit_hash_id
        ) VALUES (
          ${id}, ${auth.tenantId}::uuid, ${String(quote.broker_party_id)}::uuid,
          ${bound.providerId}, ${body.quoteId}::uuid,
          ${bound.policyNo}, ${String(quote.coverage_type)},
          ${Number(quote.sum_insured_tzs)}, ${Number(quote.premium_tzs)},
          ${Number(quote.deductible_tzs)},
          ${JSON.stringify(quote.exclusions ?? [])}::jsonb,
          ${bound.effectiveAtIso}::timestamptz,
          ${bound.expiresAtIso}::timestamptz,
          'active', ${body.evidenceDocId ?? null}::uuid,
          ${prov}::jsonb, ${hash}
        )
      `);
      await db.execute(sql`
        UPDATE insurance_quotes
           SET status = 'bound'
         WHERE id = ${body.quoteId}::uuid
           AND tenant_id = ${auth.tenantId}::uuid
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM insurance_policies
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// GET /policies - list
// ---------------------------------------------------------------------------

app.get('/policies', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const parsed = ListQuerySchema.safeParse({
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
    SELECT * FROM insurance_policies
     WHERE tenant_id = ${auth.tenantId}::uuid
       ${whereStatus}
     ORDER BY expires_at ASC
     LIMIT ${limit}
  `);
  return c.json({
    success: true,
    data: (rows as unknown as Record<string, unknown>[]) ?? [],
  });
});

// ---------------------------------------------------------------------------
// PATCH /policies/:id/cancel
// ---------------------------------------------------------------------------

app.patch(
  '/policies/:id/cancel',
  zValidator('json', CancelSchema),
  withSecurityEvents(
    {
      action: 'insurance.policy.cancel',
      resource: 'insurance.policy',
      severity: 'warning',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const id = c.req.param('id');
      const body = c.req.valid('json');

      const existing = await db.execute(sql`
        SELECT status FROM insurance_policies
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const existingRow = (
        existing as unknown as Record<string, unknown>[]
      )[0];
      if (!existingRow) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'policy not found' },
          },
          404,
        );
      }
      if (existingRow.status !== 'active') {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_STATE',
              message: `policy.status=${String(existingRow.status)} (only active can be cancelled)`,
            },
          },
          409,
        );
      }
      const cancelledAt = new Date().toISOString();
      await db.execute(sql`
        UPDATE insurance_policies
           SET status            = 'cancelled',
               cancelled_at      = ${cancelledAt}::timestamptz,
               cancelled_reason  = ${body.reason},
               updated_at        = now()
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
      `);
      const fetched = await db.execute(sql`
        SELECT * FROM insurance_policies
         WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
         LIMIT 1
      `);
      const row = (fetched as unknown as Record<string, unknown>[])[0];
      return c.json({ success: true, data: row });
    },
  ),
);

export const policiesRouter = app;
