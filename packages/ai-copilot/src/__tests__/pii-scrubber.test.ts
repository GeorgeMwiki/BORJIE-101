/**
 * PII scrubber tests — Wave-11 (English + Swahili coverage).
 */

import { describe, it, expect } from 'vitest';
import { scrubPii, buildPiiAuditRecord } from '../security/pii-scrubber.js';

describe('pii-scrubber', () => {
  it('redacts email addresses', () => {
    const r = scrubPii('Please email me at alice@example.com for details.');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('[EMAIL]');
    expect(r.scrubbed).not.toContain('alice@example.com');
  });

  it('redacts Tanzanian +255 phone numbers', () => {
    const r = scrubPii('Call me on +255 712 345 678 tomorrow.');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('[PHONE]');
    expect(r.scrubbed).not.toMatch(/\+?255.*345/);
  });

  it('redacts Kenyan +254 phone numbers', () => {
    const r = scrubPii('My number is +254 722 123 456');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('[PHONE]');
  });

  it('redacts NIDA-style IDs', () => {
    const r = scrubPii('My NIDA is 1990-1234-56789-01');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('[NIDA_ID]');
  });

  it('redacts credit card numbers', () => {
    const r = scrubPii('My card number is 4111 1111 1111 1111.');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('[CARD]');
  });

  it('uses Swahili context for phone numbers', () => {
    const r = scrubPii('Namba yangu ni 0712 345 678, tafadhali piga simu.');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('[PHONE]');
  });

  it('preserves monetary amounts like TSh 500,000', () => {
    const r = scrubPii('Please send TSh 500,000 to pay rent this month.');
    expect(r.hasPii).toBe(false);
    expect(r.scrubbed).toContain('TSh 500,000');
  });

  it('is idempotent — running twice returns same output', () => {
    const input = 'Call me at alice@example.com or 0712 345 678.';
    const once = scrubPii(input);
    const twice = scrubPii(once.scrubbed);
    expect(twice.scrubbed).toBe(once.scrubbed);
  });

  it('redacts Kenyan KRA PIN (A123456789B shape)', () => {
    const r = scrubPii('My KRA PIN is A123456789Z for the filing.');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('<kra-pin:redacted>');
    expect(r.scrubbed).not.toContain('A123456789Z');
  });

  it('redacts KRA PIN via "my kra pin is" context (English)', () => {
    const r = scrubPii('my kra pin is P987654321Q');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('<kra-pin:redacted>');
    expect(r.scrubbed).not.toContain('P987654321Q');
  });

  it('redacts KRA PIN via "nambari yangu ya kra" context (Swahili)', () => {
    const r = scrubPii('nambari yangu ya kra ni B111222333C tafadhali.');
    expect(r.hasPii).toBe(true);
    expect(r.scrubbed).toContain('<kra-pin:redacted>');
    expect(r.scrubbed).not.toContain('B111222333C');
  });

  it('buildPiiAuditRecord records types without values', () => {
    const r = scrubPii('alice@example.com, +255 712 345 678');
    const audit = buildPiiAuditRecord(r);
    expect(audit.piiDetected).toBe(true);
    expect(Array.isArray(audit.piiTypes)).toBe(true);
    const serialised = JSON.stringify(audit);
    expect(serialised).not.toContain('alice@example.com');
    expect(serialised).not.toMatch(/712[\s-]?345[\s-]?678/);
  });
});
