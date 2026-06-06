/**
 * /api/v1/marketplace/rfb-responses — commercial chain L8.
 *
 * Buyer-facing sign-delivery endpoint that triggers the settlement
 * orchestrator. Tenant-scoped via RLS; idempotent on
 * `(tenant, response, coCStepChecksum)`.
 *
 * Routes:
 *   GET  /:responseId/chain-of-custody   accepted response's CoC steps
 *                                        + canonical checksum (BY-2)
 *   POST /:responseId/sign-delivery
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  SettlementOrchestrator,
  SettlementError,
  resolveSettlementLedgerPort,
  resolveSettlementPayoutPort,
} from '../../services/settlement';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('marketplace-rfb-responses');

interface DbExecutor {
  execute(query: unknown): Promise<unknown>;
}

const SignDeliverySchema = z.object({
  coCStepChecksum: z.string().min(8).max(256),
});

function bilingualError(en: string, sw: string): { en: string; sw: string } {
  return { en, sw };
}

/** Narrow an unknown driver result to its row array (drizzle / node-pg). */
function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

/**
 * Canonical chain-of-custody checksum.
 *
 * SHA-256 over the ordered, normalised step tuple
 * `stepIndex|action|toPartyId|happenedAt|prevAuditHash` joined by `\n`.
 * Deterministic + tamper-evident: any reorder, insert, or field edit
 * changes the digest. The buyer recomputes the same digest from the
 * `steps` array we return and submits it as `coCStepChecksum` to
 * sign-delivery, so the settlement is keyed to the exact custody chain
 * the buyer reviewed. Returns '' for an empty chain (caller 404s).
 */
function canonicalCoCChecksum(
  steps: ReadonlyArray<{
    readonly stepIndex: number;
    readonly action: string;
    readonly toPartyId: string;
    readonly happenedAt: string;
    readonly prevAuditHash: string;
  }>,
): string {
  if (steps.length === 0) return '';
  const canonical = steps
    .map(
      (s) =>
        `${s.stepIndex}|${s.action}|${s.toPartyId}|${s.happenedAt}|${s.prevAuditHash}`,
    )
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex');
}

export const rfbResponsesRouter = new Hono();
rfbResponsesRouter.use('*', authMiddleware);
rfbResponsesRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /:responseId/chain-of-custody — accepted response's CoC chain (BY-2)
// ---------------------------------------------------------------------------
//
// Powers `apps/buyer-mobile/app/rfb/[id]/sign-delivery.tsx`. The buyer
// reaches sign-delivery from the L7 `rfb_fulfilled` notification (which
// carries `response_id`) but cannot compute a genuine CoC step checksum
// without the chain. This endpoint returns the ordered chain-of-custody
// steps for the fulfilled response's parcel + a canonical checksum the
// buyer submits back to POST /:responseId/sign-delivery.
//
// Link path (all rows live in the BUYER'S tenant — the whole RFB
// lifecycle is single-tenant; the seller only writes the response row,
// while dispatch + fulfilment + CoC happen in the RFB owner's tenant):
//   response → request_for_bids → mining_tasks (kind='rfb_fulfill',
//   parent_rfb_id, provenance->>'parcelId') → mineral_chain_of_custody
//   (keyed by parcel_id).
//
// RLS: databaseMiddleware binds app.current_tenant_id; every table here
// is FORCE-RLS. We additionally confirm the caller is the RFB's buyer.
// Honest 404 (NOT a fabricated chain) when the response, its parcel
// link, or the CoC rows are not reachable.
// ---------------------------------------------------------------------------
rfbResponsesRouter.get('/:responseId/chain-of-custody', async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        success: false,
        error: {
          code: 'COC_UNAVAILABLE',
          message: bilingualError(
            'Chain-of-custody service temporarily unavailable',
            'Huduma ya mnyororo wa ulinzi haipatikani kwa muda',
          ),
        },
      },
      503,
    );
  }
  const responseId = c.req.param('responseId');
  if (!/^[0-9a-f-]{36}$/i.test(responseId)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_RESPONSE_ID',
          message: bilingualError(
            'responseId must be a UUID',
            'ID ya jibu lazima iwe UUID',
          ),
        },
      },
      400,
    );
  }

  try {
    // ---- step 1: resolve response → rfb, confirm caller is the buyer --
    const respRow = rowsOf(
      await db.execute(sql`
        SELECT
          r.id::text AS response_id,
          r.rfb_id::text AS rfb_id,
          r.tenant_id::text AS tenant_id,
          r.status AS response_status,
          rfb.buyer_id AS buyer_id,
          rfb.mineral_kind AS mineral_kind
          FROM request_for_bid_responses r
          JOIN request_for_bids rfb ON rfb.id = r.rfb_id
         WHERE r.id = ${responseId}::uuid
         LIMIT 1
      `),
    )[0];

    if (!respRow) {
      return c.json(
        {
          success: false,
          error: {
            code: 'RESPONSE_NOT_FOUND',
            message: bilingualError(
              'Response not found in your tenant',
              'Jibu halijapatikana katika muktadha wako',
            ),
          },
        },
        404,
      );
    }
    if (String(respRow.buyer_id) !== auth.userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED_BUYER',
            message: bilingualError(
              'You are not the buyer for this RFB',
              'Wewe si mnunuzi wa RFB hii',
            ),
          },
        },
        403,
      );
    }

    // ---- step 2: resolve the fulfilled parcelId via the dispatch task -
    // The rfb_fulfill task carries provenance->>'parcelId' once the
    // worker fulfilment flow reports against it.
    const parcelRow = rowsOf(
      await db.execute(sql`
        SELECT mt.provenance->>'parcelId' AS parcel_id
          FROM mining_tasks mt
         WHERE mt.tenant_id = ${auth.tenantId}::uuid
           AND mt.kind = 'rfb_fulfill'
           AND mt.parent_rfb_id = ${String(respRow.rfb_id)}::uuid
           AND mt.provenance->>'parcelId' IS NOT NULL
         ORDER BY mt.created_at DESC
         LIMIT 1
      `),
    )[0];
    const parcelId = parcelRow?.parcel_id ? String(parcelRow.parcel_id) : null;

    if (!parcelId) {
      // No parcel linked yet — the fulfilment hasn't stamped a parcel.
      // Honest 404; never fabricate a chain.
      moduleLogger.info(
        { tenantId: auth.tenantId, responseId, rfbId: String(respRow.rfb_id) },
        'coc_no_linked_parcel',
      );
      return c.json(
        {
          success: false,
          error: {
            code: 'COC_PARCEL_NOT_LINKED',
            message: bilingualError(
              'No fulfilled parcel is linked to this response yet',
              'Hakuna shehena iliyokamilika iliyounganishwa na jibu hili bado',
            ),
          },
        },
        404,
      );
    }

    // ---- step 3: load ordered CoC steps for the parcel ---------------
    const stepRows = rowsOf(
      await db.execute(sql`
        SELECT
          id::text AS id,
          step_index AS step_index,
          action AS action,
          from_party_id::text AS from_party_id,
          to_party_id::text AS to_party_id,
          happened_at AS happened_at,
          weight_grams::text AS weight_grams,
          grade_pct::text AS grade_pct,
          container_seal_no AS container_seal_no,
          location AS location,
          prev_audit_hash AS prev_audit_hash
          FROM mineral_chain_of_custody
         WHERE tenant_id = ${auth.tenantId}
           AND parcel_id = ${parcelId}
         ORDER BY step_index ASC
      `),
    );

    if (stepRows.length === 0) {
      moduleLogger.info(
        { tenantId: auth.tenantId, responseId, parcelId },
        'coc_no_steps_for_parcel',
      );
      return c.json(
        {
          success: false,
          error: {
            code: 'COC_CHAIN_EMPTY',
            message: bilingualError(
              'No chain-of-custody steps recorded for this parcel',
              'Hakuna hatua za mnyororo wa ulinzi zilizorekodiwa kwa shehena hii',
            ),
          },
        },
        404,
      );
    }

    // Normalise timestamps to ISO strings for a stable checksum + payload.
    const steps = stepRows.map((s) => {
      const happenedAtRaw = s.happened_at;
      const happenedAt =
        happenedAtRaw instanceof Date
          ? happenedAtRaw.toISOString()
          : new Date(String(happenedAtRaw)).toISOString();
      return {
        id: String(s.id),
        stepIndex: Number(s.step_index ?? 0),
        action: String(s.action ?? ''),
        fromPartyId: s.from_party_id ? String(s.from_party_id) : null,
        toPartyId: String(s.to_party_id ?? ''),
        happenedAt,
        weightGrams: s.weight_grams !== null ? Number(s.weight_grams) : null,
        gradePct: s.grade_pct !== null ? Number(s.grade_pct) : null,
        containerSealNo: s.container_seal_no
          ? String(s.container_seal_no)
          : null,
        location: s.location ? String(s.location) : null,
        prevAuditHash: String(s.prev_audit_hash ?? ''),
      };
    });

    const coCStepChecksum = canonicalCoCChecksum(steps);

    return c.json(
      {
        success: true as const,
        data: {
          responseId: String(respRow.response_id),
          rfbId: String(respRow.rfb_id),
          parcelId,
          mineralKind: String(respRow.mineral_kind ?? 'mineral'),
          responseStatus: String(respRow.response_status ?? ''),
          steps,
          stepCount: steps.length,
          // The buyer submits this back to POST /:responseId/sign-delivery.
          coCStepChecksum,
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error(
      { err, tenantId: auth.tenantId, responseId },
      'coc_lookup_failed',
    );
    return c.json(
      {
        success: false,
        error: {
          code: 'COC_INTERNAL',
          message: bilingualError(
            'Failed to load chain-of-custody',
            'Imeshindwa kupakia mnyororo wa ulinzi',
          ),
        },
      },
      500,
    );
  }
});

rfbResponsesRouter.post(
  '/:responseId/sign-delivery',
  zValidator('json', SignDeliverySchema),
  async (c) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db') as DbExecutor | null;
    if (!db || !auth?.tenantId || !auth?.userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'SETTLEMENT_UNAVAILABLE',
            message: bilingualError(
              'Settlement service temporarily unavailable',
              'Huduma ya malipo haipatikani kwa muda',
            ),
          },
        },
        503,
      );
    }
    const responseId = c.req.param('responseId');
    if (!/^[0-9a-f-]{36}$/i.test(responseId)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_RESPONSE_ID',
            message: bilingualError(
              'responseId must be a UUID',
              'ID ya jibu lazima iwe UUID',
            ),
          },
        },
        400,
      );
    }
    const body = c.req.valid('json');

    // Resolve the payout rail best-effort: when it is not wired
    // (PAYOUT_NOT_WIRED — the TZS M-Pesa B2C rail is external-blocked) we pass
    // null so the settlement still posts to the ledger and is left 'posted'
    // for a background/owner-side payout, instead of 500ing the buyer.
    const payoutPort = (() => {
      try {
        return resolveSettlementPayoutPort();
      } catch {
        return null;
      }
    })();
    const orchestrator = new SettlementOrchestrator({
      db,
      ledgerPort: resolveSettlementLedgerPort(),
      payoutPort,
    });

    try {
      const result = await orchestrator.signDelivery({
        tenantId: auth.tenantId,
        buyerUserId: auth.userId,
        responseId,
        coCStepChecksum: body.coCStepChecksum,
      });

      // Cockpit fan-out — best effort.
      try {
        publishCockpitEvent({
          kind: 'opportunity.scan_completed',
          tenantId: auth.tenantId,
          emittedAt: new Date().toISOString(),
          opportunityCount: 0,
          topExpectedValueTzs: result.math.netTzs,
        });
      } catch (err) {
        moduleLogger.warn({ err }, 'sign_delivery_cockpit_event_failed');
      }

      return c.json(
        {
          success: true,
          data: {
            settlementId: result.settlementId,
            status: result.status,
            grossTzs: result.math.grossTzs,
            royaltyTzs: result.math.royaltyTzs,
            feeTzs: result.math.feeTzs,
            netTzs: result.math.netTzs,
            ledgerTxnId: result.ledgerTxnId,
            payoutProvider: result.payoutProvider,
            payoutProviderRef: result.payoutProviderRef,
            idempotent: result.idempotent,
          },
        },
        result.idempotent ? 200 : 201,
      );
    } catch (err) {
      if (err instanceof SettlementError) {
        moduleLogger.warn(
          { err, code: err.code, tenantId: auth.tenantId, responseId },
          'sign_delivery_settlement_error',
        );
        const status =
          err.code === 'RESPONSE_NOT_FOUND'
            ? 404
            : err.code === 'CROSS_TENANT_BLOCKED' ||
              err.code === 'UNAUTHORIZED_BUYER'
              ? 403
              : 500;
        return c.json(
          {
            success: false,
            error: {
              code: err.code,
              message: bilingualError(err.message, err.message),
            },
          },
          status,
        );
      }
      moduleLogger.error(
        { err, tenantId: auth.tenantId, responseId },
        'sign_delivery_unhandled',
      );
      return c.json(
        {
          success: false,
          error: {
            code: 'SETTLEMENT_INTERNAL',
            message: bilingualError(
              'Internal settlement failure',
              'Hitilafu ya ndani ya malipo',
            ),
          },
        },
        500,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// GET /settlements/mine — owner-facing settlement list (L8)
// ---------------------------------------------------------------------------
//
// Powers the owner cockpit's settlement panel + the
// `owner.settlement.list_mine` brain tool. Read-only; RLS scopes the
// result to the owner's tenant.

const ListSettlementsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

rfbResponsesRouter.get(
  '/settlements/mine',
  zValidator('query', ListSettlementsQuery),
  async (c) => {
    const auth = c.get('auth') as { tenantId?: string };
    const db = c.get('db') as DbExecutor | null;
    if (!db || !auth?.tenantId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'SETTLEMENT_UNAVAILABLE',
            message: bilingualError(
              'Settlement service temporarily unavailable',
              'Huduma ya malipo haipatikani kwa muda',
            ),
          },
        },
        503,
      );
    }
    const q = c.req.valid('query');
    // Resolve the payout rail best-effort: when it is not wired
    // (PAYOUT_NOT_WIRED — the TZS M-Pesa B2C rail is external-blocked) we pass
    // null so the settlement still posts to the ledger and is left 'posted'
    // for a background/owner-side payout, instead of 500ing the buyer.
    const payoutPort = (() => {
      try {
        return resolveSettlementPayoutPort();
      } catch {
        return null;
      }
    })();
    const orchestrator = new SettlementOrchestrator({
      db,
      ledgerPort: resolveSettlementLedgerPort(),
      payoutPort,
    });
    try {
      const settlements = await orchestrator.listForTenant({
        tenantId: auth.tenantId,
        limit: q.limit,
      });
      return c.json({ success: true, data: { settlements } });
    } catch (err) {
      moduleLogger.error(
        { err, tenantId: auth.tenantId },
        'settlements_list_failed',
      );
      return c.json(
        {
          success: false,
          error: {
            code: 'SETTLEMENT_LIST_FAILED',
            message: bilingualError(
              'Failed to load settlements',
              'Imeshindwa kupakia malipo',
            ),
          },
        },
        500,
      );
    }
  },
);

export default rfbResponsesRouter;
