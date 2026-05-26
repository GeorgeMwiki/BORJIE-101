/**
 * pii-redactor tests — boundary classification + hashing.
 *
 * The redactor is the load-bearing privacy contract: a false negative
 * here ships a raw PII value off the browser. Tests cover both the
 * `classify` enumeration and the `redact` end-to-end shape.
 */

import { describe, expect, it } from 'vitest';
import { classify, redact } from '../field-capture/pii-redactor.js';

describe('classify()', () => {
  it('returns none for short strings', () => {
    expect(classify('ab')).toBe('none');
    expect(classify('')).toBe('none');
  });

  it('returns none for non-string input', () => {
    expect(classify(undefined)).toBe('none');
    expect(classify(42)).toBe('none');
    expect(classify({ value: 'x' })).toBe('none');
  });

  it('detects emails', () => {
    expect(classify('jamhuri@mining.co.tz')).toBe('email');
  });

  it('detects phone numbers', () => {
    expect(classify('+255 712 345 678')).toBe('phone');
  });

  it('detects NIDA national-id format', () => {
    expect(classify('19850515-12345-67890-12')).toBe('nida');
  });

  it('lets plain company names pass through as none', () => {
    expect(classify('Jamhuri Mining Co')).toBe('none');
  });
});

describe('redact()', () => {
  it('returns plaintext when the value is not PII', async () => {
    const result = await redact({
      tenantId: 'tenant_1',
      tabId: 'tab_buyer_kyb_1',
      fieldId: 'company_name',
      value: 'Jamhuri Mining Co',
      hasher: async () => 'should-not-be-called',
    });
    expect(result.piiKind).toBe('none');
    expect(result.valuePlaintext).toBe('Jamhuri Mining Co');
    expect(result.valueHash).toBeUndefined();
  });

  it('hashes the value when classification is PII', async () => {
    const calls: string[] = [];
    const result = await redact({
      tenantId: 'tenant_1',
      tabId: 'tab_buyer_kyb_1',
      fieldId: 'contact_email',
      value: 'finance@jamhuri.co.tz',
      hasher: async (input) => {
        calls.push(input);
        return 'h4sh3d';
      },
    });
    expect(result.piiKind).toBe('email');
    expect(result.valuePlaintext).toBeUndefined();
    expect(result.valueHash).toBe('h4sh3d');
    expect(calls).toEqual(['tenant_1:contact_email:finance@jamhuri.co.tz']);
  });

  it('treats `type=password` as sensitive regardless of value', async () => {
    const result = await redact({
      tenantId: 'tenant_1',
      tabId: 'tab_login',
      fieldId: 'password',
      fieldType: 'password',
      value: 'plaintext-but-flagged',
      hasher: async () => 'pw-hashed',
    });
    expect(result.piiKind).toBe('card');
    expect(result.valueHash).toBe('pw-hashed');
    expect(result.valuePlaintext).toBeUndefined();
  });

  it('salts hashes with tenantId + fieldId — same value across fields is unlinkable', async () => {
    const seen: string[] = [];
    const hasher = async (input: string): Promise<string> => {
      seen.push(input);
      return input;
    };
    await redact({
      tenantId: 'tenant_1',
      tabId: 'tab_a',
      fieldId: 'field_a',
      value: 'shared@email.com',
      hasher,
    });
    await redact({
      tenantId: 'tenant_1',
      tabId: 'tab_b',
      fieldId: 'field_b',
      value: 'shared@email.com',
      hasher,
    });
    expect(seen[0]).not.toBe(seen[1]);
  });
});
