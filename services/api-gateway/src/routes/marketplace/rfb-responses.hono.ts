/**
 * /api/v1/marketplace/rfb-responses — commercial chain L8.
 *
 * Buyer-facing sign-delivery endpoint that triggers the settlement
 * orchestrator. Tenant-scoped via RLS; idempotent on
 * `(tenant, response, coCStepChecksum)`.
 *
 * Routes:
 *   POST /:responseId/sign-delivery
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

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

export const rfbResponsesRouter = new Hono();
rfbResponsesRouter.use('*', authMiddleware);
rfbResponsesRouter.use('*', databaseMiddleware);

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

    const orchestrator = new SettlementOrchestrator({
      db,
      ledgerPort: resolveSettlementLedgerPort(),
      payoutPort: resolveSettlementPayoutPort(),
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
    const orchestrator = new SettlementOrchestrator({
      db,
      ledgerPort: resolveSettlementLedgerPort(),
      payoutPort: resolveSettlementPayoutPort(),
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
