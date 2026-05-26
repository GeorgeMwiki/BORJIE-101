import { describe, it, expect } from 'vitest';
import { redactValue, looksLikePii } from '../redact/pii-redactor.js';

describe('Notion redactor', () => {
  it('redactValue is deterministic for a given (tenant, path, value)', () => {
    const a = redactValue({ tenantId: 't', fieldPath: 'title', value: 'X' });
    const b = redactValue({ tenantId: 't', fieldPath: 'title', value: 'X' });
    expect(a).toBe(b);
  });

  it('redactValue differs across tenants', () => {
    const a = redactValue({ tenantId: 't1', fieldPath: 'title', value: 'X' });
    const b = redactValue({ tenantId: 't2', fieldPath: 'title', value: 'X' });
    expect(a).not.toBe(b);
  });

  it('looksLikePii detects emails', () => {
    expect(looksLikePii('george@borjie.test')).toBe(true);
    expect(looksLikePii('just a sentence')).toBe(false);
  });

  it('looksLikePii detects Tanzanian phone numbers', () => {
    expect(looksLikePii('+255700000000')).toBe(true);
    expect(looksLikePii('255-700-000-000')).toBe(true);
  });
});
