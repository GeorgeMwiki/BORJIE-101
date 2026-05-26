import { describe, expect, it } from 'vitest';
import { redactPii } from '../ingest/pii-redactor.js';

describe('redactPii', () => {
  it('redacts email addresses', () => {
    const r = redactPii('Reach me at john.doe@example.com');
    expect(r.redacted).toContain('[EMAIL]');
    expect(r.redacted).not.toContain('john.doe');
    expect(r.redactions.some((x) => x.pattern_kind === 'email')).toBe(true);
  });

  it('redacts +254 Kenyan phone numbers', () => {
    const r = redactPii('Call +254712345678');
    expect(r.redacted).toContain('[PHONE]');
    expect(r.redactions.some((x) => x.pattern_kind === 'phone_ke')).toBe(true);
  });

  it('redacts NIDA in canonical 4-4-5-7 form', () => {
    const r = redactPii('NIDA: 1990-0512-12345-1234567');
    expect(r.redacted).toContain('[NIDA]');
  });

  it('redacts NIDA without dashes (20 digits)', () => {
    const r = redactPii('NIDA: 19900512123451234567');
    expect(r.redacted).toContain('[NIDA]');
  });

  it('redacts KRA PIN', () => {
    const r = redactPii('Pin A123456789B');
    expect(r.redacted).toContain('[KRA_PIN]');
  });

  it('counts multiple redactions accurately', () => {
    const r = redactPii('Email a@b.com and c@d.com and +254700000000');
    const email = r.redactions.find((x) => x.pattern_kind === 'email');
    expect(email?.count).toBe(2);
  });

  it('is a no-op when no PII present', () => {
    const r = redactPii('Plain text only');
    expect(r.redacted).toBe('Plain text only');
    expect(r.redactions.length).toBe(0);
  });
});
