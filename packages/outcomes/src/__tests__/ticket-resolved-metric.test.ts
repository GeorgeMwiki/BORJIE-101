/**
 * scoreTicketResolved — pass, fail, and boundary cases.
 *
 * Pure scorer; tests drive the real implementation with real inputs
 * and assert the real outputs. No mocks.
 */
import { describe, it, expect } from 'vitest';
import { scoreTicketResolved } from '../ticket-resolved-metric.js';
import type { TicketResolvedEvent } from '../types.js';

const NOW = '2026-05-23T10:00:00.000Z';

function baseEvent(
  overrides: Partial<TicketResolvedEvent> = {},
): TicketResolvedEvent {
  return {
    kind: 'ticket_resolved_within_sla',
    eventId: 'evt-1',
    tenantId: 'tenant-1',
    propertyId: 'prop-1',
    agentId: 'agent-ticket-1',
    occurredAt: NOW,
    confidence: 0.92,
    evidenceHash: 'sha256:deadbeef',
    ticketId: 'tkt-1',
    slaWindowHours: 72,
    resolutionTimeHours: 24,
    tenantConfirmed: true,
    reopenedWithinWindow: false,
    ...overrides,
  };
}

describe('scoreTicketResolved / PASS', () => {
  it('returns a qualified record at the catalog price', () => {
    const r = scoreTicketResolved(baseEvent(), {
      humanCostMinor: 4_000,
      recordId: 'rec-pass',
      nowIso: NOW,
    });
    expect(r.qualified).toBe(true);
    expect(r.billableAmountMinor).toBe(1_000); // $10
    expect(r.outcomeKind).toBe('ticket_resolved_within_sla');
    expect(r.tenantId).toBe('tenant-1');
    expect(r.priceUnitApplied?.kind).toBe('per_event');
    expect(r.currency).toBe('USD');
    // 14-day clawback closes 14 days later.
    const expectedClose = new Date(
      Date.parse(NOW) + 14 * 86_400_000,
    ).toISOString();
    expect(r.clawbackClosesAt).toBe(expectedClose);
  });

  it('caps billable amount at humanCostMinor * capFractionOfHumanCost', () => {
    // If the human cost is $5, the cap is $4.75 → 475 cents — well below
    // the $10 catalog price, so the cap should clip.
    const r = scoreTicketResolved(baseEvent(), {
      humanCostMinor: 500,
      recordId: 'rec-cap',
      nowIso: NOW,
    });
    expect(r.qualified).toBe(true);
    // floor(0.95 * 500) = 475
    expect(r.billableAmountMinor).toBe(475);
  });
});

describe('scoreTicketResolved / FAIL', () => {
  it('disqualifies when the tenant did not confirm', () => {
    const r = scoreTicketResolved(
      baseEvent({ tenantConfirmed: false }),
      { humanCostMinor: 4_000, recordId: 'rec-noconfirm', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.billableAmountMinor).toBe(0);
    expect(r.reason).toMatch(/tenant did not confirm/);
    expect(r.priceUnitApplied).toBeNull();
  });

  it('disqualifies when resolution time exceeds the SLA window', () => {
    const r = scoreTicketResolved(
      baseEvent({ slaWindowHours: 24, resolutionTimeHours: 25 }),
      { humanCostMinor: 4_000, recordId: 'rec-late', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/exceeded SLA/);
  });

  it('disqualifies when the ticket re-opened within the clawback window', () => {
    const r = scoreTicketResolved(
      baseEvent({ reopenedWithinWindow: true }),
      { humanCostMinor: 4_000, recordId: 'rec-reopen', nowIso: NOW },
    );
    expect(r.qualified).toBe(false);
    expect(r.reason).toMatch(/re-opened/);
  });
});

describe('scoreTicketResolved / BOUNDARY', () => {
  it('exactly-at-SLA is a PASS (inclusive boundary)', () => {
    const r = scoreTicketResolved(
      baseEvent({ slaWindowHours: 48, resolutionTimeHours: 48 }),
      { humanCostMinor: 4_000, recordId: 'rec-boundary', nowIso: NOW },
    );
    expect(r.qualified).toBe(true);
  });

  it('cap exactly matches catalog price — both yield catalog price', () => {
    // 0.95 * humanCost = 1000 → humanCost = ~1053. floor(0.95 * 1053) = 1000.
    const r = scoreTicketResolved(baseEvent(), {
      humanCostMinor: 1_053,
      recordId: 'rec-edge',
      nowIso: NOW,
    });
    expect(r.qualified).toBe(true);
    expect(r.billableAmountMinor).toBe(1_000);
  });

  it('throws on an unparseable nowIso', () => {
    expect(() =>
      scoreTicketResolved(baseEvent(), {
        humanCostMinor: 4_000,
        recordId: 'rec-bad',
        nowIso: 'not-a-date',
      }),
    ).toThrow(/invalid nowIso/);
  });
});
