import { describe, it, expect } from 'vitest';
import { createDefaultPIIRedactor, DEFAULT_BOUNDARY_PII_FIELDS } from '../connector-base/pii-redactor.js';

describe('createDefaultPIIRedactor', () => {
  const redactor = createDefaultPIIRedactor(DEFAULT_BOUNDARY_PII_FIELDS);

  it('redacts top-level PII keys', () => {
    const { redacted, redactedFields } = redactor.redact({
      email: 'aida@example.com',
      name: 'Aida',
    });
    expect((redacted as { email: string }).email).toBe('[REDACTED:email]');
    expect(redactedFields).toContain('email');
  });

  it('leaves non-PII keys untouched', () => {
    const { redacted } = redactor.redact({ name: 'Aida', siteId: 'pit-4' });
    expect((redacted as { name: string }).name).toBe('Aida');
  });

  it('walks nested objects', () => {
    const { redacted, redactedFields } = redactor.redact({
      msg: { user: { phone: '+255700000000', name: 'Joseph' } },
    });
    const inner = (redacted as { msg: { user: { phone: string } } }).msg.user.phone;
    expect(inner).toBe('[REDACTED:phone]');
    expect(redactedFields).toContain('msg.user.phone');
  });

  it('walks arrays', () => {
    const { redacted, redactedFields } = redactor.redact({
      contacts: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
    });
    const arr = (redacted as { contacts: Array<{ email: string }> }).contacts;
    expect(arr[0]?.email).toBe('[REDACTED:email]');
    expect(arr[1]?.email).toBe('[REDACTED:email]');
    expect(redactedFields).toContain('contacts[0].email');
    expect(redactedFields).toContain('contacts[1].email');
  });

  it('is case-insensitive on keys', () => {
    const { redacted, redactedFields } = redactor.redact({
      Email: 'x@y.com',
      PHONE: '+255700000000',
    });
    expect((redacted as { Email: string }).Email).toBe('[REDACTED:Email]');
    expect((redacted as { PHONE: string }).PHONE).toBe('[REDACTED:PHONE]');
    expect(redactedFields).toHaveLength(2);
  });

  it('redacts TZ-specific PII (NIDA, TIN, M-Pesa)', () => {
    const { redacted, redactedFields } = redactor.redact({
      nida: '19800101-12345-12345-12',
      tin: '123-456-789',
      mpesaNumber: '+255700000000',
    });
    expect((redacted as { nida: string }).nida).toBe('[REDACTED:nida]');
    expect(redactedFields).toEqual(expect.arrayContaining(['nida', 'tin', 'mpesaNumber']));
  });

  it('handles null and undefined safely', () => {
    const { redacted } = redactor.redact({ a: null, b: undefined });
    expect(redacted).toEqual({ a: null, b: undefined });
  });

  it('preserves primitives', () => {
    const { redacted } = redactor.redact(42);
    expect(redacted).toBe(42);
  });

  it('returns an empty redactedFields when nothing matches', () => {
    const { redactedFields } = redactor.redact({ siteId: 'pit-4', tonnage: 12.5 });
    expect(redactedFields).toHaveLength(0);
  });
});
