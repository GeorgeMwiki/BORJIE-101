/**
 * scoreVacancyFilled — pass, fail, and boundary cases.
 */
import { describe, it, expect } from 'vitest';
import { scoreVacancyFilled } from '../vacancy-filled-metric.js';
import type { VacancyFilledEvent } from '../types.js';

const NOW = '2026-05-23T10:00:00.000Z';

function baseEvent(
  overrides: Partial<VacancyFilledEvent> = {},
): VacancyFilledEvent {
  return {
    kind: 'vacancy_filled',
    eventId: 'evt-vac-1',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    agentId: 'agent-vacancy-1',
    occurredAt: NOW,
    confidence: 0.93,
    evidenceHash: 'sha256:beefcafe',
    unitId: 'unit-101',
    leaseId: 'lease-101',
    leaseExecuted: true,
    moveInCompleted: true,
    monthlyRentMinor: 150_000, // $1,500/mo
    currency: 'USD',
    cancelledWithinWindow: false,
    ...overrides,
  };
}

describe('scoreVacancyFilled / PASS', () => {
  it('charges half a months rent on a fully completed fill', () => {
    const r = scoreVacancyFilled(baseEvent(), {
      recordId: 'rec-v1',
      nowIso: NOW,
    });
    expect(r.qualified).toBe(true);
    expect(r.billableAmountMinor).toBe(75_000); // 0.5 * 150,000
    expect(r.outcomeKind).toBe('vacancy_filled');
    expect(r.currency).toBe('USD');
    expect(r.priceUnitApplied?.kind).toBe('fraction_of_monthly_rent');
  });

  it('honours the lease currency over the catalog default', () => {
    const r = scoreVacancyFilled(
      baseEvent({ currency: 'TZS', monthlyRentMinor: 2_500_000_00 }),
      { recordId: 'rec-tz', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
    expect(r.currency).toBe('TZS');
    expect(r.billableAmountMinor).toBe(125_000_000); // half of 2.5M shilling rent in minor
  });

  it('30-day clawback window', () => {
    const r = scoreVacancyFilled(baseEvent(), {
      recordId: 'rec-claw',
      nowIso: NOW,
    });
    const expected = new Date(
      Date.parse(NOW) + 30 * 86_400_000,
    ).toISOString();
    expect(r.clawbackClosesAt).toBe(expected);
  });
});

describe('scoreVacancyFilled / FAIL', () => {
  it('disqualifies when the lease is not yet executed', () => {
    const r = scoreVacancyFilled(
      baseEvent({ leaseExecuted: false }),
      { recordId: 'rec-noexec', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/not executed/);
    expect(r.billableAmountMinor).toBe(0);
  });

  it('disqualifies when the tenant has not moved in', () => {
    const r = scoreVacancyFilled(
      baseEvent({ moveInCompleted: false }),
      { recordId: 'rec-nomove', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/move-in/);
  });

  it('disqualifies on cancellation inside the clawback window', () => {
    const r = scoreVacancyFilled(
      baseEvent({ cancelledWithinWindow: true }),
      { recordId: 'rec-cancel', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/cancelled/);
  });

  it('disqualifies on zero or negative monthly rent', () => {
    const r1 = scoreVacancyFilled(
      baseEvent({ monthlyRentMinor: 0 }),
      { recordId: 'rec-zero', nowIso: NOW },
    );
    expect(r1.qualified).toBe(false);
    const r2 = scoreVacancyFilled(
      baseEvent({ monthlyRentMinor: -1 }),
      { recordId: 'rec-negrent', nowIso: NOW },
    );
    expect(r2.qualified).toBe(false);
  });
});

describe('scoreVacancyFilled / BOUNDARY', () => {
  it('monthlyRent = 1 minor unit floors to 0 billable', () => {
    // 0.5 * 1 = 0.5 → floor to 0.
    const r = scoreVacancyFilled(
      baseEvent({ monthlyRentMinor: 1 }),
      { recordId: 'rec-tiny', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
    expect(r.billableAmountMinor).toBe(0);
  });

  it('exactly-1-cent qualifying billable on monthlyRent = 2', () => {
    const r = scoreVacancyFilled(
      baseEvent({ monthlyRentMinor: 2 }),
      { recordId: 'rec-min-bill', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
    expect(r.billableAmountMinor).toBe(1);
  });

  it('throws on an unparseable nowIso', () => {
    expect(() =>
      scoreVacancyFilled(baseEvent(), {
        recordId: 'rec-bad',
        nowIso: 'oops',
      }),
    ).toThrow(/invalid nowIso/);
  });
});
