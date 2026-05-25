/**
 * Entity extractor tests — regex NER over user/assistant text.
 */

import { describe, it, expect } from 'vitest';
import { extractRawEntities } from '../entity-extractor.js';

describe('extractRawEntities', () => {
  it('returns empty array for empty text', () => {
    expect(extractRawEntities('')).toEqual([]);
  });

  it('extracts customer name from honorific', () => {
    const out = extractRawEntities('Mr Juma wants to lease godown 3');
    const customer = out.find((e) => e.raw_type === 'customer');
    expect(customer).toBeDefined();
    expect(customer?.value).toBe('Juma');
  });

  it('extracts unit "godown 3"', () => {
    const out = extractRawEntities('Mr Juma wants to lease godown 3');
    const unit = out.find((e) => e.raw_type === 'unit');
    expect(unit).toBeDefined();
    expect(unit?.value).toBe('godown 3');
  });

  it('extracts amount in TZ shillings with k suffix', () => {
    const out = extractRawEntities('rent is 350k per month');
    const amt = out.find((e) => e.raw_type === 'amount');
    expect(amt).toBeDefined();
    expect(amt?.value).toBe('350000');
  });

  it('extracts amount with m suffix as millions', () => {
    const out = extractRawEntities('budget is 2.5m for repairs');
    const amt = out.find((e) => e.raw_type === 'amount');
    expect(amt).toBeDefined();
    expect(amt?.value).toBe('2500000');
  });

  it('extracts month-only date "from Jan"', () => {
    const out = extractRawEntities('starting Jan');
    const date = out.find((e) => e.raw_type === 'date');
    expect(date).toBeDefined();
  });

  it('extracts ISO date 2026-05-22', () => {
    const out = extractRawEntities('on 2026-05-22');
    const date = out.find((e) => e.raw_type === 'date');
    expect(date?.value).toBe('2026-05-22');
  });

  it('extracts district Kinondoni', () => {
    const out = extractRawEntities('our Kinondoni property');
    const d = out.find((e) => e.raw_type === 'district');
    expect(d?.value).toBe('Kinondoni');
  });

  it('extracts lease id le_abc123', () => {
    const out = extractRawEntities('amend le_abc123 terms');
    const lease = out.find((e) => e.raw_type === 'lease');
    expect(lease?.value).toBe('le_abc123');
  });

  it('extracts invoice id inv_xyz456', () => {
    const out = extractRawEntities('paid inv_xyz456');
    const inv = out.find((e) => e.raw_type === 'invoice');
    expect(inv?.value).toBe('inv_xyz456');
  });

  it('drops sentence-start false-positive names', () => {
    const out = extractRawEntities('I Want to do this');
    const customer = out.find((e) => e.raw_type === 'customer');
    expect(customer).toBeUndefined();
  });

  it('dedups by (type, value)', () => {
    const out = extractRawEntities('godown 3 godown 3');
    const units = out.filter((e) => e.raw_type === 'unit');
    expect(units.length).toBe(1);
  });

  it('does not treat short plain numbers as money', () => {
    const out = extractRawEntities('only 5 items');
    const amts = out.filter((e) => e.raw_type === 'amount');
    expect(amts.length).toBe(0);
  });

  it('handles full demo: Mr Juma wants to lease godown 3 for 350k/month from Jan', () => {
    const text =
      'Mr Juma wants to lease godown 3 for 350k/month starting Jan';
    const out = extractRawEntities(text);
    const types = out.map((e) => e.raw_type);
    expect(types).toContain('customer');
    expect(types).toContain('unit');
    expect(types).toContain('amount');
    expect(types).toContain('date');
  });
});
