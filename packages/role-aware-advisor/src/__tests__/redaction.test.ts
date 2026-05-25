/**
 * Field-level redactor tests.
 */

import { describe, it, expect } from 'vitest';
import { redactFields, summariseRedactions, DEFAULT_PII_KEYS } from '../redaction.js';

describe('redactFields', () => {
  it('replaces a known PII key value with the sentinel', () => {
    const out = redactFields(
      { id: 'u1', email: 'a@b.com', name: 'Asha' },
      DEFAULT_PII_KEYS,
    );
    expect(out.email).toBe('[redacted: pii]');
    expect(out.name).toBe('[redacted: pii]');
    expect(out.id).toBe('u1');
  });

  it('passes through unknown keys untouched', () => {
    const out = redactFields(
      { id: 'u1', preferenceColour: 'green' },
      DEFAULT_PII_KEYS,
    );
    expect(out.preferenceColour).toBe('green');
  });

  it('recurses into nested objects', () => {
    const out = redactFields(
      {
        lease: {
          tenant: { name: 'Asha', email: 'a@b.com' },
        },
      },
      DEFAULT_PII_KEYS,
    );
    expect((out as any).lease.tenant.name).toBe('[redacted: pii]');
    expect((out as any).lease.tenant.email).toBe('[redacted: pii]');
  });

  it('walks arrays', () => {
    const out = redactFields(
      [{ name: 'Asha' }, { name: 'Ben' }],
      DEFAULT_PII_KEYS,
    );
    expect(out[0].name).toBe('[redacted: pii]');
    expect(out[1].name).toBe('[redacted: pii]');
  });

  it('is case-insensitive on key match', () => {
    const out = redactFields(
      { Email: 'a@b.com', PHONE: '123' },
      DEFAULT_PII_KEYS,
    );
    expect((out as any).Email).toBe('[redacted: pii]');
    expect((out as any).PHONE).toBe('[redacted: pii]');
  });

  it('null sentinel option replaces with null', () => {
    const out = redactFields(
      { email: 'a@b.com' },
      DEFAULT_PII_KEYS,
      { sentinel: 'null' },
    );
    expect(out.email).toBeNull();
  });

  it('custom reason flows into the sentinel', () => {
    const out = redactFields(
      { email: 'a@b.com' },
      ['email'],
      { reason: 'gdpr' },
    );
    expect(out.email).toBe('[redacted: gdpr]');
  });

  it('does not mutate the input', () => {
    const input = { email: 'a@b.com', nested: { name: 'X' } };
    const before = JSON.stringify(input);
    redactFields(input, DEFAULT_PII_KEYS);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('preserves empty strings and zero values (only non-empty trigger sentinel)', () => {
    const out = redactFields(
      { email: '', count: 0, name: null },
      DEFAULT_PII_KEYS,
    );
    expect(out.email).toBe('');
    expect(out.count).toBe(0);
    expect(out.name).toBeNull();
  });

  it('handles cyclic objects without stack overflow', () => {
    const a: any = { name: 'X' };
    a.self = a;
    const out = redactFields(a, DEFAULT_PII_KEYS) as any;
    expect(out.name).toBe('[redacted: pii]');
  });
});

describe('summariseRedactions', () => {
  it('returns the de-duplicated list of touched keys', () => {
    const before = { email: 'a@b.com', other: 'x', deep: { name: 'Y' } };
    const after = redactFields(before, DEFAULT_PII_KEYS);
    const touched = summariseRedactions(before, after, DEFAULT_PII_KEYS);
    expect(touched.sort()).toEqual(['email', 'name']);
  });

  it('returns empty when nothing changed', () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1, b: 2 };
    expect(summariseRedactions(before, after, DEFAULT_PII_KEYS)).toEqual([]);
  });
});
