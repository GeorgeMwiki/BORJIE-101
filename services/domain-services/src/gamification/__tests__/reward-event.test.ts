/**
 * RewardEvent factory — append-only event helper.
 */

import { describe, it, expect } from 'vitest';
import { newRewardEvent, type RewardEvent } from '../reward-event.js';

function makeFields(): Omit<RewardEvent, 'id' | 'createdAt'> & { id: string } {
  return {
    id: 'evt_1',
    tenantId: 'tnt_1',
    customerId: 'cust_1',
    eventType: 'on_time_payment',
    policyId: 'pol_1',
    scoreDelta: 10,
    creditDeltaMinor: 0,
    cashbackDeltaMinor: 0,
    currency: 'TZS',
    paymentId: 'pay_1',
    invoiceId: 'inv_1',
    fromTier: null,
    toTier: 'bronze',
    payload: {},
    dedupKey: 'pay_1:on_time_payment',
    occurredAt: '2026-05-08T00:00:00Z',
  };
}

describe('newRewardEvent', () => {
  it('returns the same fields plus a fresh createdAt timestamp', () => {
    const fields = makeFields();
    const event = newRewardEvent(fields);
    expect(event.id).toBe(fields.id);
    expect(event.tenantId).toBe(fields.tenantId);
    expect(event.eventType).toBe(fields.eventType);
    expect(event.scoreDelta).toBe(10);
    expect(typeof event.createdAt).toBe('string');
    expect(() => new Date(event.createdAt).toISOString()).not.toThrow();
  });

  it('does not mutate the input fields', () => {
    const fields = makeFields();
    const before = JSON.parse(JSON.stringify(fields));
    newRewardEvent(fields);
    expect(fields).toEqual(before);
  });

  it('preserves null tier transitions', () => {
    const event = newRewardEvent({ ...makeFields(), fromTier: null, toTier: null });
    expect(event.fromTier).toBeNull();
    expect(event.toTier).toBeNull();
  });

  it('preserves dedupKey for idempotency', () => {
    const event = newRewardEvent({
      ...makeFields(),
      dedupKey: 'unique-dedup-key-xyz',
    });
    expect(event.dedupKey).toBe('unique-dedup-key-xyz');
  });

  it('accepts negative scoreDelta for late penalties', () => {
    const event = newRewardEvent({
      ...makeFields(),
      eventType: 'late_payment',
      scoreDelta: -15,
    });
    expect(event.scoreDelta).toBe(-15);
    expect(event.eventType).toBe('late_payment');
  });

  it('accepts cashback deltas', () => {
    const event = newRewardEvent({
      ...makeFields(),
      eventType: 'cashback_paid',
      cashbackDeltaMinor: 50_000,
    });
    expect(event.cashbackDeltaMinor).toBe(50_000);
  });

  it('produces createdAt later than (or equal to) occurredAt', () => {
    const occurredAt = '2020-01-01T00:00:00Z';
    const event = newRewardEvent({ ...makeFields(), occurredAt });
    expect(new Date(event.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(occurredAt).getTime(),
    );
  });
});
