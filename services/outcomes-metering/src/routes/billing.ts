/**
 * GET /outcomes/billing/:tenantId/:month — read aggregated billing.
 *
 * Returns the per-tenant per-month aggregate the billing engine
 * consumes. `:month` is YYYY-MM (e.g. `2026-05`). The aggregate
 * carries:
 *
 *   - `byOutcome` — qualifiedCount + totalBillableMinor + currencies
 *     per outcome kind (ticket_resolved / rent_collected / vacancy_filled).
 *   - `totalBillableMinor` — sum across all qualified lines.
 *   - `dominantCurrency` — the most-used currency in the month.
 *
 * Tenant scoping: the request's `tenantId` MUST equal the
 * `X-Tenant-Id` header so a leaked URL can't be replayed under
 * another tenant. The route refuses on mismatch with a 403.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../middleware/auth.js';
import type { BillingStore } from '../store/billing-store.js';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const RouteParamsSchema = z.object({
  tenantId: z.string().min(1),
  month: z.string().regex(MONTH_REGEX),
});

export interface RegisterBillingRoutesDeps {
  readonly store: BillingStore;
}

export async function registerBillingRoutes(
  app: FastifyInstance,
  deps: RegisterBillingRoutesDeps,
): Promise<void> {
  app.get(
    '/outcomes/billing/:tenantId/:month',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = RouteParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_path_params',
          details: parsed.error.flatten(),
        });
      }
      const { tenantId, month } = parsed.data;
      // The path tenantId MUST equal the session tenantId from the
      // verified JWT — a leaked URL replayed under another principal
      // can't read another tenant's billing aggregate.
      const sessionTenantId = requireUser(request).tenantId;
      if (sessionTenantId !== tenantId) {
        return reply.code(403).send({
          error: 'tenant_id_mismatch',
          message: 'session tenant and path tenantId disagree',
        });
      }

      const aggregate = await deps.store.getMonthlyBilling(tenantId, month);
      return reply.code(200).send(aggregate);
    },
  );
}
