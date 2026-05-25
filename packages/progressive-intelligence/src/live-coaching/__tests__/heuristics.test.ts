import { describe, expect, it } from 'vitest';
import type { CoachingSchema } from '../../types.js';
import { heuristicCoach } from '../heuristics.js';

const rentSchema: CoachingSchema = {
  entityKind: 'tenant',
  fields: [
    { name: 'displayName', type: 'string', required: true, label: 'Display name' },
    {
      name: 'monthlyRent',
      type: 'number',
      required: true,
      expectedRange: { min: 1000, max: 5_000_000 },
      label: 'Monthly rent (TZS)',
    },
    { name: 'currency', type: 'enum', allowedValues: ['TZS', 'KES', 'USD'] },
    { name: 'moveInDate', type: 'date' },
    { name: 'active', type: 'boolean' },
  ],
};

describe('heuristicCoach', () => {
  it('flags missing required field', () => {
    const hints = heuristicCoach({
      workInProgress: { monthlyRent: 100_000 },
      schema: rentSchema,
    });
    expect(hints.some((h) => h.field === 'displayName' && h.reason === 'missing_required')).toBe(
      true,
    );
  });

  it('flags below-range numeric value', () => {
    const hints = heuristicCoach({
      workInProgress: { displayName: 'Jane', monthlyRent: 10 },
      schema: rentSchema,
    });
    expect(hints.some((h) => h.field === 'monthlyRent' && h.reason === 'below_range')).toBe(true);
  });

  it('flags above-range numeric value', () => {
    const hints = heuristicCoach({
      workInProgress: { displayName: 'Jane', monthlyRent: 9_999_999_999 },
      schema: rentSchema,
    });
    expect(hints.some((h) => h.field === 'monthlyRent' && h.reason === 'above_range')).toBe(true);
  });

  it('blocks bad enum value', () => {
    const hints = heuristicCoach({
      workInProgress: { displayName: 'Jane', monthlyRent: 100_000, currency: 'GBP' },
      schema: rentSchema,
    });
    const enumHint = hints.find((h) => h.field === 'currency');
    expect(enumHint?.severity).toBe('block');
    expect(enumHint?.reason).toBe('bad_enum');
  });

  it('blocks wrong type', () => {
    const hints = heuristicCoach({
      workInProgress: {
        displayName: 'Jane',
        monthlyRent: 'not a number',
        active: 'yes',
      },
      schema: rentSchema,
    });
    expect(hints.some((h) => h.field === 'monthlyRent' && h.reason === 'wrong_type')).toBe(true);
    expect(hints.some((h) => h.field === 'active' && h.reason === 'wrong_type')).toBe(true);
  });

  it('blocks invalid date', () => {
    const hints = heuristicCoach({
      workInProgress: { displayName: 'Jane', monthlyRent: 100_000, moveInDate: 'tomorrow' },
      schema: rentSchema,
    });
    expect(hints.some((h) => h.field === 'moveInDate' && h.reason === 'wrong_type')).toBe(true);
  });

  it('returns nothing for a fully valid form', () => {
    const hints = heuristicCoach({
      workInProgress: {
        displayName: 'Jane',
        monthlyRent: 350_000,
        currency: 'TZS',
        moveInDate: '2026-06-01',
        active: true,
      },
      schema: rentSchema,
    });
    expect(hints).toHaveLength(0);
  });

  it('is deterministic — same input yields same ids', () => {
    const wip = { monthlyRent: 5 };
    const a = heuristicCoach({ workInProgress: wip, schema: rentSchema });
    const b = heuristicCoach({ workInProgress: wip, schema: rentSchema });
    expect(b.map((h) => h.id)).toEqual(a.map((h) => h.id));
  });
});
