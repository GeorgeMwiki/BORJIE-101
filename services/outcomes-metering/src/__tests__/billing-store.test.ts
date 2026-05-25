/**
 * In-memory billing store tests.
 *
 * Verifies:
 *   - recordEvent is idempotent on (tenantId, eventId)
 *   - recordBillingLine is idempotent on (tenantId, recordId)
 *   - getMonthlyBilling aggregates per outcome kind correctly
 *   - tenant scoping isolates aggregates across tenants
 *   - month scoping isolates aggregates across months
 *   - dominantCurrency reflects the most-used currency in the slice
 */

import { describe, it, expect } from 'vitest';
import type { MeteringRecord } from '@borjie/outcomes';
import { createInMemoryBillingStore } from '../store/billing-store.js';

function meteringRecord(over: Partial<MeteringRecord> = {}): MeteringRecord {
  return {
    recordId: 'rec_' + Math.random().toString(36).slice(2),
    outcomeKind: 'ticket_resolved_within_sla',
    tenantId: 't_demo',
    propertyId: 'p_a',
    eventId: 'evt_' + Math.random().toString(36).slice(2),
    qualified: true,
    reason: 'resolved within SLA',
    billableAmountMinor: 1000,
    currency: 'USD',
    priceUnitApplied: null,
    scoredAt: '2026-05-15T10:00:00.000Z',
    clawbackClosesAt: '2026-05-29T10:00:00.000Z',
    ...over,
  };
}

describe('createInMemoryBillingStore', () => {
  it('recordEvent is idempotent on (tenantId, eventId)', async () => {
    const store = createInMemoryBillingStore();
    const first = await store.recordEvent({
      tenantId: 't_demo',
      eventId: 'evt_1',
      outcomeKind: 'ticket_resolved_within_sla',
      propertyId: 'p_a',
      agentId: 'a_x',
      occurredAtIso: '2026-05-15T08:00:00.000Z',
      payload: { kind: 'ticket_resolved_within_sla' } as never,
      sourceEventType: 'ticket.resolved',
    });
    const second = await store.recordEvent({
      tenantId: 't_demo',
      eventId: 'evt_1',
      outcomeKind: 'ticket_resolved_within_sla',
      propertyId: 'p_a',
      agentId: 'a_x',
      occurredAtIso: '2026-05-15T08:00:00.000Z',
      payload: { kind: 'ticket_resolved_within_sla' } as never,
      sourceEventType: 'ticket.resolved',
    });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
  });

  it('recordEvent isolates across tenants for the same eventId', async () => {
    const store = createInMemoryBillingStore();
    const insertA = await store.recordEvent({
      tenantId: 't_a',
      eventId: 'evt_shared',
      outcomeKind: 'ticket_resolved_within_sla',
      propertyId: 'p_a',
      agentId: 'a_x',
      occurredAtIso: '2026-05-15T08:00:00.000Z',
      payload: { kind: 'ticket_resolved_within_sla' } as never,
      sourceEventType: 'ticket.resolved',
    });
    const insertB = await store.recordEvent({
      tenantId: 't_b',
      eventId: 'evt_shared',
      outcomeKind: 'ticket_resolved_within_sla',
      propertyId: 'p_a',
      agentId: 'a_x',
      occurredAtIso: '2026-05-15T08:00:00.000Z',
      payload: { kind: 'ticket_resolved_within_sla' } as never,
      sourceEventType: 'ticket.resolved',
    });
    expect(insertA.inserted).toBe(true);
    expect(insertB.inserted).toBe(true);
  });

  it('recordBillingLine is idempotent on (tenantId, recordId)', async () => {
    const store = createInMemoryBillingStore();
    const record = meteringRecord({ recordId: 'rec_dup', tenantId: 't_demo' });
    const first = await store.recordBillingLine(record);
    const second = await store.recordBillingLine(record);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
  });

  it('getMonthlyBilling aggregates qualified records per outcome', async () => {
    const store = createInMemoryBillingStore();
    await store.recordBillingLine(
      meteringRecord({
        outcomeKind: 'ticket_resolved_within_sla',
        billableAmountMinor: 1000,
        currency: 'USD',
        scoredAt: '2026-05-01T00:00:00.000Z',
      }),
    );
    await store.recordBillingLine(
      meteringRecord({
        outcomeKind: 'ticket_resolved_within_sla',
        billableAmountMinor: 800,
        currency: 'USD',
        scoredAt: '2026-05-12T00:00:00.000Z',
      }),
    );
    await store.recordBillingLine(
      meteringRecord({
        outcomeKind: 'rent_collected',
        billableAmountMinor: 50_000,
        currency: 'USD',
        scoredAt: '2026-05-20T00:00:00.000Z',
      }),
    );
    await store.recordBillingLine(
      meteringRecord({
        outcomeKind: 'vacancy_filled',
        billableAmountMinor: 250_000,
        currency: 'KES',
        scoredAt: '2026-05-25T00:00:00.000Z',
      }),
    );

    const aggregate = await store.getMonthlyBilling('t_demo', '2026-05');
    expect(aggregate.qualifiedLineCount).toBe(4);
    expect(aggregate.byOutcome.ticket_resolved_within_sla.qualifiedCount).toBe(2);
    expect(aggregate.byOutcome.ticket_resolved_within_sla.totalBillableMinor).toBe(1800);
    expect(aggregate.byOutcome.rent_collected.totalBillableMinor).toBe(50_000);
    expect(aggregate.byOutcome.vacancy_filled.totalBillableMinor).toBe(250_000);
    expect(aggregate.totalBillableMinor).toBe(1800 + 50_000 + 250_000);
    // USD appears 3x (2 tickets + 1 rent); KES appears 1x.
    expect(aggregate.dominantCurrency).toBe('USD');
  });

  it('getMonthlyBilling ignores rows from other tenants', async () => {
    const store = createInMemoryBillingStore();
    await store.recordBillingLine(
      meteringRecord({
        tenantId: 't_a',
        billableAmountMinor: 1000,
        scoredAt: '2026-05-15T00:00:00.000Z',
      }),
    );
    await store.recordBillingLine(
      meteringRecord({
        tenantId: 't_b',
        billableAmountMinor: 9_999,
        scoredAt: '2026-05-15T00:00:00.000Z',
      }),
    );
    const aggregate = await store.getMonthlyBilling('t_a', '2026-05');
    expect(aggregate.qualifiedLineCount).toBe(1);
    expect(aggregate.totalBillableMinor).toBe(1000);
  });

  it('getMonthlyBilling ignores rows from other months', async () => {
    const store = createInMemoryBillingStore();
    await store.recordBillingLine(
      meteringRecord({
        tenantId: 't_demo',
        billableAmountMinor: 1000,
        scoredAt: '2026-05-15T00:00:00.000Z',
      }),
    );
    await store.recordBillingLine(
      meteringRecord({
        tenantId: 't_demo',
        billableAmountMinor: 9_999,
        scoredAt: '2026-06-15T00:00:00.000Z',
      }),
    );
    const aggregate = await store.getMonthlyBilling('t_demo', '2026-05');
    expect(aggregate.qualifiedLineCount).toBe(1);
    expect(aggregate.totalBillableMinor).toBe(1000);
  });

  it('getMonthlyBilling skips unqualified billing lines', async () => {
    const store = createInMemoryBillingStore();
    await store.recordBillingLine(
      meteringRecord({
        tenantId: 't_demo',
        qualified: false,
        billableAmountMinor: 0,
        scoredAt: '2026-05-15T00:00:00.000Z',
      }),
    );
    await store.recordBillingLine(
      meteringRecord({
        tenantId: 't_demo',
        qualified: true,
        billableAmountMinor: 1000,
        scoredAt: '2026-05-15T00:00:00.000Z',
      }),
    );
    const aggregate = await store.getMonthlyBilling('t_demo', '2026-05');
    expect(aggregate.qualifiedLineCount).toBe(1);
    expect(aggregate.totalBillableMinor).toBe(1000);
  });

  it('returns a zero aggregate when the month has no qualified rows', async () => {
    const store = createInMemoryBillingStore();
    const aggregate = await store.getMonthlyBilling('t_demo', '2026-05');
    expect(aggregate.qualifiedLineCount).toBe(0);
    expect(aggregate.totalBillableMinor).toBe(0);
    expect(aggregate.byOutcome.ticket_resolved_within_sla.qualifiedCount).toBe(0);
    expect(aggregate.byOutcome.rent_collected.qualifiedCount).toBe(0);
    expect(aggregate.byOutcome.vacancy_filled.qualifiedCount).toBe(0);
    expect(aggregate.dominantCurrency).toBe('USD');
  });
});
