/**
 * POST /outcomes/events — manual OutcomeEvent submission endpoint.
 *
 * Production traffic lands on the brain-event-bus consumer
 * (`createBrainEventConsumer`); this HTTP route exists for two
 * concrete use cases:
 *
 *   - Operators and integration tests can replay a single
 *     OutcomeEvent without standing up a bus.
 *   - The billing engine and admin UI can backfill an event that
 *     was lost in an outage with full traceability.
 *
 * Idempotent on `(tenantId, eventId)` — the underlying store rejects
 * duplicates by construction and we propagate `{ inserted: false }`
 * as a 200 with `idempotent: true` rather than 4xx.
 *
 * Tenant scoping: the caller supplies `tenantId` in the request
 * header `X-Tenant-Id`. The route refuses requests with no header in
 * production (when `NODE_ENV === 'production'`); dev/test deploys
 * trust the header for simplicity.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  scoreRentCollected,
  scoreTicketResolved,
  scoreVacancyFilled,
  type MeteringRecord,
  type OutcomeEvent,
} from '@borjie/outcomes';
import {
  recordSecurityEvent,
  withSecurityEventsFastify,
} from '@borjie/observability';
import { requireUser } from '../middleware/auth.js';
import type { BillingStore } from '../store/billing-store.js';
// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const OutcomeEventInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ticket_resolved_within_sla'),
    eventId: z.string().min(1),
    tenantId: z.string().min(1),
    propertyId: z.string().min(1),
    agentId: z.string().min(1),
    occurredAt: z.string().min(1),
    confidence: z.number().min(0).max(1),
    evidenceHash: z.string(),
    ticketId: z.string().min(1),
    slaWindowHours: z.number().int().min(0),
    resolutionTimeHours: z.number().min(0),
    tenantConfirmed: z.boolean(),
    reopenedWithinWindow: z.boolean(),
    /** Optional industry-baseline human-cost cents. Defaults 4000 ($40). */
    humanCostMinor: z.number().int().min(0).optional(),
  }),
  z.object({
    kind: z.literal('rent_collected'),
    eventId: z.string().min(1),
    tenantId: z.string().min(1),
    propertyId: z.string().min(1),
    agentId: z.string().min(1),
    occurredAt: z.string().min(1),
    confidence: z.number().min(0).max(1),
    evidenceHash: z.string(),
    billingPeriod: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    collectedMinor: z.number().int().min(0),
    recoveredDelinquencyMinor: z.number().int().min(0),
    baselineCollectedMinor: z.number().int().min(0),
    bankReconciled: z.boolean(),
    chargedBack: z.boolean(),
  }),
  z.object({
    kind: z.literal('vacancy_filled'),
    eventId: z.string().min(1),
    tenantId: z.string().min(1),
    propertyId: z.string().min(1),
    agentId: z.string().min(1),
    occurredAt: z.string().min(1),
    confidence: z.number().min(0).max(1),
    evidenceHash: z.string(),
    unitId: z.string().min(1),
    leaseId: z.string().min(1),
    leaseExecuted: z.boolean(),
    moveInCompleted: z.boolean(),
    monthlyRentMinor: z.number().int().min(0),
    currency: z.string().length(3),
    cancelledWithinWindow: z.boolean(),
  }),
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective tenantId for a request. ALWAYS returns the
 * session-bound value from the verified JWT — the legacy `X-Tenant-Id`
 * header trust path was removed (P75 / P86 closure CWE-285). The
 * body's `tenantId` is still cross-checked further down: a mismatch
 * fires a security event and rejects the request, since it indicates
 * either an operator confusion or a tampering attempt.
 */
function pickTenantId(request: FastifyRequest): string {
  return requireUser(request).tenantId;
}

function scoreOutcome(
  event: OutcomeEvent,
  nowIso: string,
  recordId: string,
  humanCostMinor: number | undefined,
): MeteringRecord {
  switch (event.kind) {
    case 'ticket_resolved_within_sla':
      return scoreTicketResolved(event, {
        recordId,
        nowIso,
        humanCostMinor: humanCostMinor ?? 4000,
      });
    case 'rent_collected':
      return scoreRentCollected(event, { recordId, nowIso });
    case 'vacancy_filled':
      return scoreVacancyFilled(event, { recordId, nowIso });
    default: {
      // Exhaustiveness — never reached because the schema is closed.
      const _exhaustive: never = event;
      throw new Error(`outcomes-metering: unhandled outcome kind ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export interface RegisterEventsRoutesDeps {
  readonly store: BillingStore;
  readonly clock?: () => Date;
  readonly newRecordId?: () => string;
}

export async function registerEventsRoutes(
  app: FastifyInstance,
  deps: RegisterEventsRoutesDeps,
): Promise<void> {
  const clock = deps.clock ?? (() => new Date());
  const newRecordId = deps.newRecordId ?? (() => randomUUID());

  app.post('/outcomes/events', withSecurityEventsFastify({ action: 'events.create', resource: 'events', severity: 'info' }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = OutcomeEventInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_event_payload',
        details: parsed.error.flatten(),
      });
    }
    const event = parsed.data;
    const tenantId = pickTenantId(request);

    // Cross-check: the body's tenantId MUST match the session-derived
    // tenantId. Otherwise a confused operator could write into the
    // wrong tenant's billing log. Emit a security event so SREs can
    // detect tampering attempts or stale clients.
    if (event.tenantId !== tenantId) {
      void recordSecurityEvent({
        action: 'outcomes.events.create.tenant_mismatch',
        resource: 'events',
        severity: 'warn',
        method: request.method,
        route: request.url,
        tenantId,
        actorId: requireUser(request).userId,
        detail: {
          sessionTenantId: tenantId,
          bodyTenantId: event.tenantId,
          note: 'request rejected — body tenant disagrees with session tenant',
        },
      });
      return reply.code(403).send({
        error: 'tenant_id_mismatch',
        message: 'session tenant and payload tenantId disagree',
      });
    }

    // 1. Append-only event row (idempotent on (tenantId, eventId)).
    const tightEvent: OutcomeEvent = event;
    const eventRow = await deps.store.recordEvent({
      tenantId,
      eventId: tightEvent.eventId,
      outcomeKind: tightEvent.kind,
      propertyId: tightEvent.propertyId,
      agentId: tightEvent.agentId,
      occurredAtIso: tightEvent.occurredAt,
      payload: tightEvent,
      sourceEventType: 'http.outcome.event',
    });
    if (!eventRow.inserted) {
      return reply.code(200).send({
        idempotent: true,
        message: 'event already recorded',
        eventId: tightEvent.eventId,
      });
    }

    // 2. Score + persist the billing line.
    // Pull humanCostMinor off the request body (the schema carries it
    // ONLY for the ticket variant). The OutcomeEvent type we hand to
    // the scorer does not declare the field — it's a scorer option,
    // not an event field.
    const requestEvent = event;
    const humanCostMinor =
      requestEvent.kind === 'ticket_resolved_within_sla'
        ? requestEvent.humanCostMinor
        : undefined;
    const meteringRecord = scoreOutcome(
      tightEvent,
      clock().toISOString(),
      newRecordId(),
      humanCostMinor,
    );
    await deps.store.recordBillingLine(meteringRecord);

    return reply.code(201).send({
      idempotent: false,
      eventId: tightEvent.eventId,
      recordId: meteringRecord.recordId,
      qualified: meteringRecord.qualified,
      reason: meteringRecord.reason,
      billableAmountMinor: meteringRecord.billableAmountMinor,
      currency: meteringRecord.currency,
      clawbackClosesAt: meteringRecord.clawbackClosesAt,
    });
  }));
}
