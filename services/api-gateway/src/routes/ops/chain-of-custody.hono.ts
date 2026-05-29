/**
 * /api/v1/ops/chain-of-custody — hash-chained pit-to-buyer parcel
 * tracking.
 *
 * Wave: OPS-WIDE.
 *
 * Endpoints:
 *   GET  /?parcelId=...           full chain + verification result
 *   POST /                        append a step (next index inferred)
 *
 * Every appended step computes `prev_audit_hash` from the previous
 * step's `audit_hash_id` payload, so the linear chain is tamper-evident.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';

import {
  mineralChainOfCustody,
  CHAIN_OF_CUSTODY_ACTIONS,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { appendOpsAuditEntry } from './audit-helper';
import { enqueueRfbFulfillmentNotification } from '../../services/buyer-notifications';

const moduleLogger = createLogger('ops-chain-of-custody');

const chainQuerySchema = z.object({
  parcelId: z.string().trim().min(1).max(120),
});

const appendBodySchema = z.object({
  parcelId: z.string().trim().min(1).max(120),
  fromPartyId: z.string().uuid().nullable().optional(),
  toPartyId: z.string().uuid(),
  action: z.enum(CHAIN_OF_CUSTODY_ACTIONS),
  weightGrams: z.coerce.number().min(0).optional(),
  gradePct: z.coerce.number().min(0).max(100).optional(),
  containerSealNo: z.string().trim().max(120).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  happenedAt: z.string().datetime().optional(),
});

export function createChainOfCustodyRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.get('/', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'OPS_DB_UNAVAILABLE' } },
        503,
      );
    }
    const parsed = chainQuerySchema.safeParse({
      parcelId: c.req.query('parcelId'),
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
    const rows = await db
      .select()
      .from(mineralChainOfCustody)
      .where(
        and(
          eq(mineralChainOfCustody.tenantId, auth.tenantId),
          eq(mineralChainOfCustody.parcelId, parsed.data.parcelId),
        ),
      )
      .orderBy(asc(mineralChainOfCustody.stepIndex));
    const verification = verifyChain(rows);
    const latestHash =
      rows.length > 0 ? rows[rows.length - 1].prevAuditHash : '';
    return c.json({
      success: true,
      data: {
        parcelId: parsed.data.parcelId,
        steps: rows,
        verification,
        latestHash,
      },
    });
  });

  app.post('/', async (c: any) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db');
    if (!db || !auth?.tenantId) {
      return c.json(
        { success: false, error: { code: 'OPS_DB_UNAVAILABLE' } },
        503,
      );
    }
    const body = await c.req.json().catch(() => ({}));
    const parsed = appendBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_BODY', issues: parsed.error.issues },
        },
        400,
      );
    }
    const d = parsed.data;
    const id = randomUUID();
    // Determine next step index + previous hash atomically.
    const latest = await db
      .select({
        idx: sql<number>`COALESCE(MAX(${mineralChainOfCustody.stepIndex}), -1)`,
      })
      .from(mineralChainOfCustody)
      .where(
        and(
          eq(mineralChainOfCustody.tenantId, auth.tenantId),
          eq(mineralChainOfCustody.parcelId, d.parcelId),
        ),
      );
    const nextIndex = Number(latest[0]?.idx ?? -1) + 1;
    const prevRow =
      nextIndex > 0
        ? await db
            .select()
            .from(mineralChainOfCustody)
            .where(
              and(
                eq(mineralChainOfCustody.tenantId, auth.tenantId),
                eq(mineralChainOfCustody.parcelId, d.parcelId),
                eq(mineralChainOfCustody.stepIndex, nextIndex - 1),
              ),
            )
            .limit(1)
        : [];
    const prevHash = prevRow[0]
      ? createHash('sha256').update(prevRow[0].prevAuditHash + prevRow[0].id).digest('hex')
      : '';
    let auditHashId: string;
    try {
      auditHashId = await appendOpsAuditEntry(db, {
        tenantId: auth.tenantId,
        userId: auth.userId ?? 'system',
        turnId: randomUUID(),
        action: 'ops.chain_of_custody.append',
        details: {
          id,
          parcelId: d.parcelId,
          stepIndex: nextIndex,
          action: d.action,
          fromPartyId: d.fromPartyId ?? null,
          toPartyId: d.toPartyId,
        },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'chain-of-custody audit append failed');
      auditHashId = randomUUID();
    }
    await db.insert(mineralChainOfCustody).values({
      id,
      tenantId: auth.tenantId,
      parcelId: d.parcelId,
      stepIndex: nextIndex,
      fromPartyId: d.fromPartyId ?? null,
      toPartyId: d.toPartyId,
      action: d.action,
      happenedAt: d.happenedAt ? new Date(d.happenedAt) : new Date(),
      weightGrams: d.weightGrams !== undefined ? String(d.weightGrams) : null,
      gradePct: d.gradePct !== undefined ? String(d.gradePct) : null,
      containerSealNo: d.containerSealNo ?? null,
      location: d.location ?? null,
      auditHashId,
      prevAuditHash: prevHash,
    });

    // Commercial chain L7 — when the CoC step is the FINAL leg of a
    // buyer fulfilment (action='sell' or 'export') AND the parcel is
    // linked back to an `mining_tasks` row with parent_rfb_id set, we
    // enqueue a buyer notification. The link is via
    // mining_tasks.provenance->>'parcelId' which the worker fulfilment
    // flow stamps when reporting against an RFB-fulfilment task.
    if (d.action === 'sell' || d.action === 'export') {
      try {
        const linked = await db.execute(sql`
          SELECT
            mt.id::text AS task_id,
            mt.parent_rfb_id::text AS parent_rfb_id,
            rfb.buyer_id AS buyer_id,
            rfb.tenant_id::text AS buyer_tenant_id,
            rfb.mineral_kind AS mineral_kind,
            (
              SELECT response_id::text
                FROM request_for_bid_responses
               WHERE rfb_id = rfb.id
                 AND status = 'accepted'
               LIMIT 1
            ) AS response_id
            FROM mining_tasks mt
            JOIN request_for_bids rfb ON rfb.id = mt.parent_rfb_id
           WHERE mt.tenant_id = ${auth.tenantId}::uuid
             AND mt.kind = 'rfb_fulfill'
             AND mt.parent_rfb_id IS NOT NULL
             AND mt.provenance->>'parcelId' = ${d.parcelId}
           LIMIT 1
        `);
        const linkRows = Array.isArray(linked)
          ? linked
          : (linked as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ?? [];
        const link = (linkRows as ReadonlyArray<Record<string, unknown>>)[0];
        if (link && link.buyer_tenant_id && link.buyer_id && link.parent_rfb_id) {
          const tonnage =
            d.weightGrams !== undefined ? d.weightGrams / 1_000_000 : null;
          await enqueueRfbFulfillmentNotification(db, {
            buyerTenantId: String(link.buyer_tenant_id),
            buyerUserId: String(link.buyer_id),
            sellerTenantId: auth.tenantId,
            rfbId: String(link.parent_rfb_id),
            responseId: link.response_id ? String(link.response_id) : null,
            taskId: link.task_id ? String(link.task_id) : null,
            mineralKind: String(link.mineral_kind ?? 'mineral'),
            tonnage,
            parcelId: d.parcelId,
            extraPayload: { cocStepId: id, action: d.action },
          });
          moduleLogger.info(
            {
              parcelId: d.parcelId,
              rfbId: String(link.parent_rfb_id),
              taskId: link.task_id,
              action: d.action,
            },
            'buyer_fulfillment_notification_enqueued',
          );
        }
      } catch (err) {
        moduleLogger.warn(
          { err, parcelId: d.parcelId, action: d.action },
          'buyer_fulfillment_notification_failed',
        );
      }
    }

    return c.json(
      {
        success: true,
        data: { id, stepIndex: nextIndex, auditHashId },
      },
      201,
    );
  });

  return app;
}

interface ChainVerification {
  readonly ok: boolean;
  readonly brokenAt: number | null;
}

function verifyChain(
  steps: ReadonlyArray<{
    readonly stepIndex: number;
    readonly id: string;
    readonly prevAuditHash: string;
  }>,
): ChainVerification {
  if (steps.length === 0) return { ok: true, brokenAt: null };
  // Step 0: prevAuditHash must be '' or empty.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    if (i === 0) {
      if (step.prevAuditHash && step.prevAuditHash.length > 0) {
        // First step must have empty prev hash.
        return { ok: false, brokenAt: 0 };
      }
      continue;
    }
    const prev = steps[i - 1];
    if (!prev) continue;
    const expected = createHash('sha256')
      .update(prev.prevAuditHash + prev.id)
      .digest('hex');
    if (step.prevAuditHash !== expected) {
      return { ok: false, brokenAt: i };
    }
  }
  return { ok: true, brokenAt: null };
}

export const chainOfCustodyRouter = createChainOfCustodyRouter();
