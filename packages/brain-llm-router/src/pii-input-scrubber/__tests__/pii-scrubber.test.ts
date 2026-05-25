/**
 * Tests for `pii-scrubber.ts` + `pii-patterns.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resetPiiScrubberConfig,
  safePayload,
  safeText,
  setPiiScrubberConfig,
} from '../pii-scrubber.js';
import { PII_PATTERNS, scrubPiiText } from '../pii-patterns.js';

beforeEach(() => {
  resetPiiScrubberConfig();
});

afterEach(() => {
  resetPiiScrubberConfig();
});

describe('scrubPiiText — PII patterns', () => {
  it('redacts email addresses', () => {
    const out = scrubPiiText('Contact me at jane@example.com please');
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).not.toContain('jane@example.com');
  });

  it('redacts +254 phone numbers', () => {
    const out = scrubPiiText('Call +254 712 345 678');
    expect(out).toContain('[REDACTED_PHONE]');
  });

  it('redacts +255 (TZ) phone numbers', () => {
    const out = scrubPiiText('Tafadhali piga +255-754-123-456');
    expect(out).toContain('[REDACTED_PHONE]');
  });

  it('redacts local 07xx phone numbers', () => {
    const out = scrubPiiText('My number is 0712345678 thanks');
    expect(out).toContain('[REDACTED_PHONE]');
  });

  it('redacts TZ NIDA 20-digit IDs', () => {
    const out = scrubPiiText('NIDA: 19900101-12345-12345-12 issued 2020');
    expect(out).toContain('[REDACTED_NIDA]');
  });

  it('redacts UG NIN 14-char IDs', () => {
    // UG NIN: 14 chars total, leading C/M/F + 13 alnum
    // 14 chars total: leading "C" + 13 alphanumeric
    const out = scrubPiiText('NIN C12345678901AB is mine');
    expect(out).toContain('[REDACTED_NIN]');
  });

  it('redacts valid Luhn credit cards', () => {
    // 4532015112830366 passes Luhn
    const out = scrubPiiText('Card: 4532015112830366 on file');
    expect(out).toContain('[REDACTED_CARD]');
  });

  it('does NOT redact non-Luhn long digit runs (false-positive prevention)', () => {
    // 1234567890123456 fails Luhn
    const input = 'TX 1234567890123456 reference';
    const out = scrubPiiText(input);
    expect(out).toContain('1234567890123456');
    expect(out).not.toContain('[REDACTED_CARD]');
  });

  it('leaves clean text unchanged', () => {
    const input = 'Your rent is due on the 1st.';
    expect(scrubPiiText(input)).toBe(input);
  });
});

describe('safeText — 3-stage cascade', () => {
  it('redacts brand names (default)', () => {
    const out = safeText('We migrated from AppFolio to Borjie');
    expect(out).toContain('[REDACTED_BRAND]');
    expect(out).not.toContain('AppFolio');
  });

  it('honours an injected brandRedactor', () => {
    setPiiScrubberConfig({
      brandRedactor: (s) => s.replace(/MyCompetitor/g, '[CUSTOM_BRAND]'),
    });
    const out = safeText('Switched from MyCompetitor');
    expect(out).toContain('[CUSTOM_BRAND]');
  });

  it('honours an injected Presidio scrubber', () => {
    setPiiScrubberConfig({
      presidioScrubber: (s) => s.replace(/Jane Doe/g, '<PERSON>'),
    });
    const out = safeText('Met with Jane Doe today');
    expect(out).toContain('<PERSON>');
  });

  it('idempotent: double-scrub same output', () => {
    const input = 'Email jane@example.com phone +254712345678';
    const r1 = safeText(input);
    const r2 = safeText(r1);
    expect(r1).toBe(r2);
  });

  it('returns empty/non-string unchanged', () => {
    expect(safeText('')).toBe('');
    expect(safeText(null as unknown as string)).toBe(null);
  });
});

describe('safePayload — deep walk', () => {
  it('scrubs string leaves in flat object', () => {
    const out = safePayload({ email: 'jane@example.com', name: 'OK' });
    expect(out.email).toBe('[REDACTED_EMAIL]');
    expect(out.name).toBe('OK');
  });

  it('scrubs leaves in nested arrays', () => {
    const out = safePayload({
      contacts: [{ email: 'a@b.com' }, { email: 'c@d.com' }],
    });
    expect(out.contacts[0]?.email).toBe('[REDACTED_EMAIL]');
    expect(out.contacts[1]?.email).toBe('[REDACTED_EMAIL]');
  });

  it('does not mutate the original', () => {
    const original = { email: 'jane@example.com' };
    safePayload(original);
    expect(original.email).toBe('jane@example.com');
  });

  it('preserves Date and RegExp leaves unchanged', () => {
    const d = new Date();
    const r = /foo/;
    const out = safePayload({ created: d, pattern: r });
    expect(out.created).toBe(d);
    expect(out.pattern).toBe(r);
  });

  it('handles circular references without infinite loop', () => {
    const obj: Record<string, unknown> = { email: 'jane@example.com' };
    obj.self = obj;
    expect(() => safePayload(obj)).not.toThrow();
  });

  it('caps depth at 8', () => {
    let deep: Record<string, unknown> = { email: 'jane@example.com' };
    for (let i = 0; i < 15; i += 1) deep = { next: deep };
    // Should not throw or stack-overflow
    expect(() => safePayload(deep)).not.toThrow();
  });

  it('handles primitives at root', () => {
    expect(safePayload('jane@example.com')).toBe('[REDACTED_EMAIL]');
    expect(safePayload(42)).toBe(42);
    expect(safePayload(null)).toBe(null);
  });
});

describe('PII_PATTERNS metadata', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(PII_PATTERNS)).toBe(true);
  });

  it('includes all 5-jurisdiction national IDs', () => {
    const names = PII_PATTERNS.map((p) => p.name);
    expect(names).toContain('tz_nida');
    expect(names).toContain('ug_nin');
    expect(names).toContain('rw_nid');
    expect(names).toContain('ke_huduma_or_ng_nin');
  });
});
