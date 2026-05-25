/**
 * Brain-event-bus consumer tests.
 *
 * Verifies the wiring between the in-memory BrainEventBus, the pure
 * outcome scorers from `@borjie/outcomes`, and the in-memory
 * billing store:
 *
 *   - subscribes to `lease.signed`, `payment.received`, `ticket.resolved`
 *   - translates the brain event payload into the typed OutcomeEvent
 *   - scores the event using the matching pure scorer
 *   - persists a billing line into the store
 *   - is idempotent across re-deliveries of the same eventId
 *   - aggregation math: monthly aggregate matches the sum of line writes
 *   - silently skips intermediate `payment.received` events (only
 *     month-close events translate to billable outcomes)
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryBrainEventBus } from '@borjie/ai-copilot/brain-event-bus';
import type { BrainEvent } from '@borjie/ai-copilot/brain-event-bus';
import { createInMemoryBillingStore } from '../store/billing-store.js';
import {
  createBrainEventConsumer,
  OUTCOMES_METERING_EVENT_TYPES,
} from '../consumers/brain-event-consumer.js';

const TENANT = 't_demo';
const FIXED_NOW = new Date('2026-05-20T12:00:00.000Z');
const fixedClock = (): Date => FIXED_NOW;

function emptyAcl(): BrainEvent['acl'] {
  return { userIds: [], roleIds: [] };
}

function leaseSignedEvent(over: Partial<{ eventId: string; cancelled: boolean }> = {}): BrainEvent {
  return {
    type: OUTCOMES_METERING_EVENT_TYPES.LEASE_SIGNED,
    tenantId: TENANT,
    actorId: 'agent_letting_a',
    subjectId: 'unit_42',
    sourceSystem: 'system',
    observedAt: new Date('2026-05-10T10:00:00.000Z'),
    acl: emptyAcl(),
    payload: {
      eventId: over.eventId ?? 'evt_lease_1',
      propertyId: 'p_1',
      agentId: 'agent_letting_a',
      occurredAt: '2026-05-10T10:00:00.000Z',
      confidence: 0.95,
      evidenceHash: 'sha256:abc',
      unitId: 'unit_42',
      leaseId: 'lease_42',
      leaseExecuted: true,
      moveInCompleted: true,
      monthlyRentMinor: 500_000, // $5000 / mo
      currency: 'USD',
      cancelledWithinWindow: over.cancelled ?? false,
    },
  };
}

function ticketResolvedEvent(over: Partial<{ eventId: string; resolutionTimeHours: number }> = {}): BrainEvent {
  return {
    type: OUTCOMES_METERING_EVENT_TYPES.TICKET_RESOLVED,
    tenantId: TENANT,
    actorId: 'agent_maint_b',
    subjectId: 'ticket_xy',
    sourceSystem: 'system',
    observedAt: new Date('2026-05-12T14:00:00.000Z'),
    acl: emptyAcl(),
    payload: {
      eventId: over.eventId ?? 'evt_ticket_1',
      propertyId: 'p_1',
      agentId: 'agent_maint_b',
      occurredAt: '2026-05-12T14:00:00.000Z',
      confidence: 0.9,
      evidenceHash: 'sha256:def',
      ticketId: 'ticket_xy',
      slaWindowHours: 48,
      resolutionTimeHours: over.resolutionTimeHours ?? 12,
      tenantConfirmed: true,
      reopenedWithinWindow: false,
      humanCostMinor: 4000,
    },
  };
}

function paymentReceivedEvent(over: Partial<{ eventId: string; monthClose: boolean }> = {}): BrainEvent {
  return {
    type: OUTCOMES_METERING_EVENT_TYPES.PAYMENT_RECEIVED,
    tenantId: TENANT,
    actorId: 'agent_finance_c',
    subjectId: 'lease_42',
    sourceSystem: 'mpesa',
    observedAt: new Date('2026-05-31T18:00:00.000Z'),
    acl: emptyAcl(),
    payload: {
      eventId: over.eventId ?? 'evt_payment_1',
      propertyId: 'p_1',
      agentId: 'agent_finance_c',
      occurredAt: '2026-05-31T18:00:00.000Z',
      confidence: 1,
      evidenceHash: 'sha256:ghi',
      billingPeriod: '2026-05',
      collectedMinor: 800_000,
      recoveredDelinquencyMinor: 0,
      baselineCollectedMinor: 500_000,
      bankReconciled: true,
      chargedBack: false,
      monthClose: over.monthClose ?? true,
    },
  };
}

// Tiny utility — the brain event bus dispatches on a microtask, so we
// need to yield before reading the store.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('createBrainEventConsumer wiring', () => {
  it('subscribes to the three OutcomeEvent-producing types', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    const handle = createBrainEventConsumer({ bus, store, clock: fixedClock });

    const types = handle.subscriptions.map((s) => s.type);
    expect(types).toEqual([
      OUTCOMES_METERING_EVENT_TYPES.LEASE_SIGNED,
      OUTCOMES_METERING_EVENT_TYPES.PAYMENT_RECEIVED,
      OUTCOMES_METERING_EVENT_TYPES.TICKET_RESOLVED,
    ]);
    handle.stop();
  });

  it('scores a lease.signed event into a qualified vacancy_filled billing line', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    createBrainEventConsumer({ bus, store, clock: fixedClock });

    await bus.publish(leaseSignedEvent({ eventId: 'evt_lease_qa' }));
    await settle();

    const aggregate = await store.getMonthlyBilling(TENANT, '2026-05');
    expect(aggregate.qualifiedLineCount).toBe(1);
    expect(aggregate.byOutcome.vacancy_filled.qualifiedCount).toBe(1);
    // 0.5 (half month) * 500_000 = 250_000.
    expect(aggregate.byOutcome.vacancy_filled.totalBillableMinor).toBe(250_000);
  });

  it('scores a ticket.resolved event into a qualified ticket billing line', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    createBrainEventConsumer({ bus, store, clock: fixedClock });

    await bus.publish(ticketResolvedEvent({ eventId: 'evt_tk_qa' }));
    await settle();

    const aggregate = await store.getMonthlyBilling(TENANT, '2026-05');
    expect(aggregate.byOutcome.ticket_resolved_within_sla.qualifiedCount).toBe(1);
    expect(aggregate.byOutcome.ticket_resolved_within_sla.totalBillableMinor).toBeGreaterThan(0);
  });

  it('is idempotent on re-deliveries of the same eventId', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    createBrainEventConsumer({ bus, store, clock: fixedClock });

    const ev = leaseSignedEvent({ eventId: 'evt_repeat_1' });
    await bus.publish(ev);
    await settle();
    await bus.publish(ev);
    await settle();
    await bus.publish(ev);
    await settle();

    const aggregate = await store.getMonthlyBilling(TENANT, '2026-05');
    // Three publishes of the same eventId must produce exactly one
    // billing line.
    expect(aggregate.byOutcome.vacancy_filled.qualifiedCount).toBe(1);
  });

  it('skips intermediate payment.received events (not month-close)', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    createBrainEventConsumer({ bus, store, clock: fixedClock });

    await bus.publish(paymentReceivedEvent({ eventId: 'evt_p_partial', monthClose: false }));
    await settle();

    const aggregate = await store.getMonthlyBilling(TENANT, '2026-05');
    expect(aggregate.byOutcome.rent_collected.qualifiedCount).toBe(0);
    expect(aggregate.qualifiedLineCount).toBe(0);
  });

  it('aggregates a mixed stream of events into the right monthly totals', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    createBrainEventConsumer({ bus, store, clock: fixedClock });

    await bus.publish(leaseSignedEvent({ eventId: 'evt_mix_lease_1' }));
    await bus.publish(ticketResolvedEvent({ eventId: 'evt_mix_tk_1' }));
    await bus.publish(ticketResolvedEvent({ eventId: 'evt_mix_tk_2' }));
    await bus.publish(paymentReceivedEvent({ eventId: 'evt_mix_pay_1', monthClose: true }));
    await settle();
    // Allow downstream async settles within the bus dispatcher.
    await settle();
    await settle();

    const aggregate = await store.getMonthlyBilling(TENANT, '2026-05');
    expect(aggregate.byOutcome.vacancy_filled.qualifiedCount).toBe(1);
    expect(aggregate.byOutcome.ticket_resolved_within_sla.qualifiedCount).toBe(2);
    expect(aggregate.byOutcome.rent_collected.qualifiedCount).toBe(1);
    expect(aggregate.qualifiedLineCount).toBe(4);
  });

  it('does NOT score an SLA-busting ticket', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    createBrainEventConsumer({ bus, store, clock: fixedClock });

    await bus.publish(
      ticketResolvedEvent({
        eventId: 'evt_sla_bust',
        resolutionTimeHours: 200, // way past 48h SLA
      }),
    );
    await settle();

    const aggregate = await store.getMonthlyBilling(TENANT, '2026-05');
    // Scorer marks the record !qualified — aggregator should skip it.
    expect(aggregate.byOutcome.ticket_resolved_within_sla.qualifiedCount).toBe(0);
  });

  it('does NOT score a cancelled-within-window lease', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    createBrainEventConsumer({ bus, store, clock: fixedClock });

    await bus.publish(leaseSignedEvent({ eventId: 'evt_lease_cxl', cancelled: true }));
    await settle();

    const aggregate = await store.getMonthlyBilling(TENANT, '2026-05');
    expect(aggregate.byOutcome.vacancy_filled.qualifiedCount).toBe(0);
  });

  it('stop() detaches every subscription so further events are no-ops', async () => {
    const bus = createInMemoryBrainEventBus();
    const store = createInMemoryBillingStore();
    const handle = createBrainEventConsumer({ bus, store, clock: fixedClock });

    handle.stop();
    await bus.publish(leaseSignedEvent({ eventId: 'evt_lease_after_stop' }));
    await settle();

    const aggregate = await store.getMonthlyBilling(TENANT, '2026-05');
    expect(aggregate.qualifiedLineCount).toBe(0);
  });
});
