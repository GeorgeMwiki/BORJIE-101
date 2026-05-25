/**
 * scoreRentCollected — pass, fail, and boundary cases.
 */
import { describe, it, expect } from 'vitest';
import { scoreRentCollected } from '../rent-collected-metric.js';
import type { RentCollectedEvent } from '../types.js';

const NOW = '2026-05-23T10:00:00.000Z';

function baseEvent(
  overrides: Partial<RentCollectedEvent> = {},
): RentCollectedEvent {
  return {
    kind: 'rent_collected',
    eventId: 'evt-rent-1',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    agentId: 'agent-collect-1',
    occurredAt: NOW,
    confidence: 0.99,
    evidenceHash: 'sha256:cafebabe',
    billingPeriod: '2026-05',
    collectedMinor: 11_000_000, // $110,000 collected this month
    recoveredDelinquencyMinor: 500_000, // $5,000 of delinquency clawed back
    baselineCollectedMinor: 10_000_000, // $100,000 baseline
    bankReconciled: true,
    chargedBack: false,
    ...overrides,
  };
}

describe('scoreRentCollected / PASS', () => {
  it('charges 2% of lift + 10% of recovered delinquency when percentage exceeds the floor', () => {
    const r = scoreRentCollected(baseEvent(), {
      recordId: 'rec-r1',
      nowIso: NOW,
    });
    expect(r.qualified).toBe(true);
    // lift = 11,000,000 - 10,000,000 = 1,000,000. 2% = 20,000.
    // recovered delinquency = 500,000. 10% = 50,000.
    // total = 70,000 (above the 20,000 retainer floor).
    expect(r.billableAmountMinor).toBe(70_000);
    expect(r.outcomeKind).toBe('rent_collected');
    expect(r.currency).toBe('USD');
  });

  it('uses the min-retainer floor when computed amount is lower', () => {
    // No lift, no delinquency → falls to $200 floor.
    const r = scoreRentCollected(
      baseEvent({
        collectedMinor: 900_000,
        baselineCollectedMinor: 1_000_000,
        recoveredDelinquencyMinor: 0,
      }),
      { recordId: 'rec-floor', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
    expect(r.billableAmountMinor).toBe(20_000); // $200 floor retainer
  });

  it('90-day clawback window', () => {
    const r = scoreRentCollected(baseEvent(), {
      recordId: 'rec-claw',
      nowIso: NOW,
    });
    const expected = new Date(
      Date.parse(NOW) + 90 * 86_400_000,
    ).toISOString();
    expect(r.clawbackClosesAt).toBe(expected);
  });
});

describe('scoreRentCollected / FAIL', () => {
  it('disqualifies when bank reconciliation has not yet cleared', () => {
    const r = scoreRentCollected(
      baseEvent({ bankReconciled: false }),
      { recordId: 'rec-nobank', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/bank-reconciled/);
    expect(r.billableAmountMinor).toBe(0);
  });

  it('disqualifies when the payment was charged back', () => {
    const r = scoreRentCollected(
      baseEvent({ chargedBack: true }),
      { recordId: 'rec-cb', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/charged back/);
  });

  it('rejects negative collectedMinor (data error)', () => {
    const r = scoreRentCollected(
      baseEvent({ collectedMinor: -1 }),
      { recordId: 'rec-neg', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/negative/);
  });
});

describe('scoreRentCollected / BOUNDARY', () => {
  it('lift exactly equals 0 — billable comes from retainer + delinquency', () => {
    const r = scoreRentCollected(
      baseEvent({
        collectedMinor: 1_000_000,
        baselineCollectedMinor: 1_000_000,
        recoveredDelinquencyMinor: 30_000, // 10% = 3,000
      }),
      { recordId: 'rec-eq', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
    // 3,000 < 20,000 retainer → bill the retainer.
    expect(r.billableAmountMinor).toBe(20_000);
  });

  it('lift just under 1 minor unit floors to 0 on percentage', () => {
    // lift = 49 (less than 50 needed for 2% to produce 1 cent of revenue)
    // applyBp(49, 200) = floor(49 * 200 / 10000) = floor(0.98) = 0
    const r = scoreRentCollected(
      baseEvent({
        collectedMinor: 1_000_049,
        baselineCollectedMinor: 1_000_000,
        recoveredDelinquencyMinor: 0,
      }),
      { recordId: 'rec-floor-bp', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
    // 0 + 0 < 20,000 → retainer.
    expect(r.billableAmountMinor).toBe(20_000);
  });

  it('exact 2% lift produces the exact billable amount (no rounding loss)', () => {
    // lift = 50,000 → 2% = 1,000 cents.
    const r = scoreRentCollected(
      baseEvent({
        collectedMinor: 1_050_000,
        baselineCollectedMinor: 1_000_000,
        recoveredDelinquencyMinor: 0,
      }),
      { recordId: 'rec-precise', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
    // 1,000 < 20,000 → retainer.
    expect(r.billableAmountMinor).toBe(20_000);
  });

  it('big lift exceeds retainer → percentage wins', () => {
    // lift = 100,000,000 cents → 2% = 2,000,000 cents = $20,000.
    const r = scoreRentCollected(
      baseEvent({
        collectedMinor: 101_000_000,
        baselineCollectedMinor: 1_000_000,
        recoveredDelinquencyMinor: 0,
      }),
      { recordId: 'rec-big', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
    expect(r.billableAmountMinor).toBe(2_000_000);
  });
});
