/**
 * Catalog integrity — the entire billing engine depends on these
 * invariants, so test them directly. No mocks.
 */
import { describe, it, expect } from 'vitest';
import {
  catalogIsConsistent,
  getOutcome,
  listOutcomes,
} from '../catalog.js';
import { OUTCOME_KINDS } from '../types.js';

describe('catalog', () => {
  it('exposes exactly the three first-monetizable outcomes in stable order', () => {
    const list = listOutcomes();
    expect(list.map((o) => o.kind)).toEqual([
      'ticket_resolved_within_sla',
      'rent_collected',
      'vacancy_filled',
    ]);
  });

  it('every catalog entry self-identifies with its registry key', () => {
    expect(catalogIsConsistent()).toBe(true);
  });

  it('every OutcomeKind has a catalog entry', () => {
    for (const kind of OUTCOME_KINDS) {
      const o = getOutcome(kind);
      expect(o.kind).toBe(kind);
      expect(o.pricing.length).toBeGreaterThan(0);
      expect(o.clawbackWindowDays).toBeGreaterThan(0);
      expect(o.displayName.length).toBeGreaterThan(0);
    }
  });

  it('ticket_resolved_within_sla carries a human-cost cap', () => {
    const o = getOutcome('ticket_resolved_within_sla');
    const perEvent = o.pricing.find((u) => u.kind === 'per_event');
    expect(perEvent).toBeDefined();
    if (perEvent && perEvent.kind === 'per_event') {
      expect(perEvent.capFractionOfHumanCost).toBeCloseTo(0.95);
      expect(perEvent.amountMinor).toBe(1_000);
    }
  });

  it('rent_collected carries a min retainer on the collected unit', () => {
    const o = getOutcome('rent_collected');
    const collected = o.pricing.find(
      (u) => u.kind === 'percentage_of' && u.appliesTo === 'collected_minor',
    );
    expect(collected).toBeDefined();
    if (collected && collected.kind === 'percentage_of') {
      expect(collected.minRetainerMinor).toBe(20_000);
      expect(collected.basisPoints).toBe(200);
    }
  });

  it('vacancy_filled prices at half a month of rent', () => {
    const o = getOutcome('vacancy_filled');
    const u = o.pricing[0];
    expect(u?.kind).toBe('fraction_of_monthly_rent');
    if (u && u.kind === 'fraction_of_monthly_rent') {
      expect(u.fraction).toBeCloseTo(0.5);
    }
  });
});
