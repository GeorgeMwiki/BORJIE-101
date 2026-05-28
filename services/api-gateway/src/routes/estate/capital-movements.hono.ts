// @ts-nocheck — Hono v4 TypedResponse widening.
/**
 * /api/v1/estate/capital-movements — view-layer ledger of
 * intercompany flows. The actual money STILL posts through
 * LedgerService.post(); this surface stores narrative + metadata only.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  estateCapitalMovements,
  ESTATE_CAPITAL_KINDS,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from '../ops/audit-helper';

const moduleLogger = createLogger('estate-capital-movements');

const listQuerySchema = z.object({
  fromEntityId: z.string().uuid().optional(),
  toEntityId: z.string().uuid().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  kind: z.enum(ESTATE_CAPITAL_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const createSchema = z.object({
  fromEntityId: z.string().uuid().nullable().optional(),
  toEntityId: z.string().uuid().nullable().optional(),
  kind: z.enum(ESTATE_CAPITAL_KINDS),
  amount: z.coerce.number().min(0),
  currency: z.string().trim().min(2).max(8).default('TZS'),
  happenedAt: z.string().datetime().optional(),
  narrative: z.string().trim().max(4000).nullable().optional(),
  docLinkId: z.string().trim().max(120).nullable().optional(),
  ledgerEntryId: z.string().trim().max(120).nullable().optional(),
});

export function createEstateCapitalMovementsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.get('/', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'ESTATE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = listQuerySchema.safeParse({
      fromEntityId: c.req.query('fromEntityId'),
      toEntityId: c.req.query('toEntityId'),
      since: c.req.query('since'),
      until: c.req.query('until'),
      kind: c.req.query('kind'),
      limit: c.req.query('limit'),
    });
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_QUERY', issues: parsed.error.issues },
        },
        400,
      );
    }
    const q = parsed.data;
    const whereParts = [
      eq(estateCapitalMovements.tenantId, auth.tenantId),
    ];
    if (q.fromEntityId)
      whereParts.push(eq(estateCapitalMovements.fromEntityId, q.fromEntityId));
    if (q.toEntityId)
      whereParts.push(eq(estateCapitalMovements.toEntityId, q.toEntityId));
    if (q.kind) whereParts.push(eq(estateCapitalMovements.kind, q.kind));
    if (q.since)
      whereParts.push(
        gte(estateCapitalMovements.happenedAt, new Date(q.since)),
      );
    if (q.until)
      whereParts.push(
        lte(estateCapitalMovements.happenedAt, new Date(q.until)),
      );
    const rows = await db
      .select()
      .from(estateCapitalMovements)
      .where(and(...whereParts))
      .orderBy(desc(estateCapitalMovements.happenedAt))
      .limit(q.limit);
    return c.json({
      success: true,
      data: { movements: rows, count: rows.length },
    });
  });

  app.post('/', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'ESTATE_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = createSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_BODY', issues: parsed.error.issues },
        },
        400,
      );
    }
    const id = randomUUID();
    const d = parsed.data;
    let auditHashId: string | null = null;
    try {
      auditHashId = await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'estate.capital_movement.create',
        details: {
          id,
          fromEntityId: d.fromEntityId ?? null,
          toEntityId: d.toEntityId ?? null,
          kind: d.kind,
          amount: d.amount,
          currency: d.currency,
        },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'capital-movement audit append failed');
    }
    await db.insert(estateCapitalMovements).values({
      id,
      tenantId: auth.tenantId,
      fromEntityId: d.fromEntityId ?? null,
      toEntityId: d.toEntityId ?? null,
      kind: d.kind,
      amount: String(d.amount),
      currency: d.currency,
      happenedAt: d.happenedAt ? new Date(d.happenedAt) : new Date(),
      narrative: d.narrative ?? null,
      docLinkId: d.docLinkId ?? null,
      ledgerEntryId: d.ledgerEntryId ?? null,
      auditHashId,
    });
    return c.json({ success: true, data: { id, auditHashId } }, 201);
  });

  return app;
}

export const estateCapitalMovementsRouter =
  createEstateCapitalMovementsRouter();
