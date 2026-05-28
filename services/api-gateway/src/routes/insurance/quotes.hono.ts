/**
 * /api/v1/insurance/quotes (migration 0106).
 *
 * Quote-request lifecycle. Owner / admin submits a coverage spec; the
 * insurance broker port fans out to enrolled providers and persists
 * each returned offer as an `insurance_quotes` row. The owner-web
 * /insurance/page.tsx reads pending quotes; the chat-as-OS brain
 * reads via `insurance.get_quotes`.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   POST  /quotes   request quotes
 *   GET   /quotes   list quotes for current tenant
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

const COVERAGE_TYPES = [
  'workforce',
  'plant',
  'environmental',
  'third_party',
  'transit',
  'political_risk',
] as const;

const QuoteRequestBody = z.object({
  brokerPartyId: z.string().uuid(),
  coverageType: z.enum(COVERAGE_TYPES),
  sumInsuredTzs: z.number().nonnegative(),
  location: z
    .object({
      country: z.string().length(2).default('TZ'),
      region: z.string().max(64).optional(),
    })
    .default({ country: 'TZ' }),
  riskProfile: z.record(z.unknown()).default({}),
});

const ListQuerySchema = z.object({
  status: z.enum(['open', 'bound', 'expired', 'declined']).optional(),
  coverageType: z.enum(COVERAGE_TYPES).optional(),
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

// ---------------------------------------------------------------------------
// POST /quotes - request quotes via broker port
// ---------------------------------------------------------------------------

app.post(
  '/quotes',
  zValidator('json', QuoteRequestBody),
  withSecurityEvents(
    {
      action: 'insurance.quote.request',
      resource: 'insurance.quote',
      severity: 'info',
    },
    async (c) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);
      const body = c.req.valid('json');
      const broker = selectInsuranceBrokerProvider(process.env);
      const offers = await broker.getQuotes({
        coverageType: body.coverageType,
        sumInsuredTzs: body.sumInsuredTzs,
        location: body.location,
        riskProfile: body.riskProfile,
      });

      const persisted: Array<Record<string, unknown>> = [];
      for (const offer of offers) {
        const id = randomUUID();
        const prov = provenance(auth.userId, 'web');
        const hash = auditHash({
          id,
          tenantId: auth.tenantId,
          providerId: offer.providerId,
          coverageType: body.coverageType,
          premiumTzs: offer.premiumTzs,
        });
        await db.execute(sql`
          INSERT INTO insurance_quotes (
            id, tenant_id, broker_party_id, provider_id,
            coverage_type, sum_insured_tzs, premium_tzs, deductible_tzs,
            exclusions, valid_until, status, risk_profile,
            provenance, audit_hash_id
          ) VALUES (
            ${id}, ${auth.tenantId}::uuid, ${body.brokerPartyId}::uuid,
            ${offer.providerId}, ${body.coverageType},
            ${body.sumInsuredTzs}, ${offer.premiumTzs}, ${offer.deductibleTzs},
            ${JSON.stringify(offer.exclusions)}::jsonb,
            ${offer.validUntilIso}::timestamptz,
            'open', ${JSON.stringify(body.riskProfile)}::jsonb,
            ${prov}::jsonb, ${hash}
          )
        `);
        const fetched = await db.execute(sql`
          SELECT * FROM insurance_quotes
           WHERE id = ${id}::uuid AND tenant_id = ${auth.tenantId}::uuid
           LIMIT 1
        `);
        const row = (fetched as unknown as Record<string, unknown>[])[0];
        if (row) persisted.push(row);
      }
      return c.json({ success: true, data: persisted }, 201);
    },
  ),
);

// ---------------------------------------------------------------------------
// GET /quotes - list
// ---------------------------------------------------------------------------

app.get('/quotes', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const parsed = ListQuerySchema.safeParse({
    status: c.req.query('status'),
    coverageType: c.req.query('coverageType'),
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
  const { status, coverageType, limit } = parsed.data;
  const whereStatus = status ? sql`AND status = ${status}` : sql``;
  const whereCoverage = coverageType
    ? sql`AND coverage_type = ${coverageType}`
    : sql``;
  const rows = await db.execute(sql`
    SELECT * FROM insurance_quotes
     WHERE tenant_id = ${auth.tenantId}::uuid
       ${whereStatus}
       ${whereCoverage}
     ORDER BY created_at DESC
     LIMIT ${limit}
  `);
  return c.json({
    success: true,
    data: (rows as unknown as Record<string, unknown>[]) ?? [],
  });
});

export const quotesRouter = app;
