/**
 * `redactPiiFromString()` — regression coverage for the 2026-05-21
 * HIGH bug where the Tanzania NIDA regex was too greedy. The previous
 * pattern accepted optional separators and a 2–4-digit tail, which
 * accidentally matched 13–17-digit audit timestamps like
 * `2024051512345678`. The corrected pattern requires either the
 * canonical 4-4-5-7 hyphenated form OR exactly 20 contiguous digits
 * beginning with 19xx / 20xx (birth year).
 */

import { describe, expect, it } from 'vitest';

import { redactPiiFromString } from '../schema-sniff/pii-redactor.js';

describe('redactPiiFromString — NIDA regex tightness', () => {
  it('does NOT redact a 16-digit audit timestamp masquerading as NIDA', () => {
    // Real-world example: ledger entries serialise timestamps in
    // YYYYMMDDHHMMSSmmm-ish formats. None of these should match
    // the NIDA pattern.
    const input = 'Action recorded at 2024051512345678 by tenant t-1.';
    const out = redactPiiFromString(input);
    expect(out).toBe(input);
    expect(out).not.toContain('[NIDA_ID]');
  });

  it('does NOT redact other near-misses around the NIDA length boundary', () => {
    // 13, 17, 18, 19-digit strings — all close enough to the old
    // greedy pattern to collide with it. None should match now.
    const cases = [
      '2024051512345', // 13 digits
      '20240515123456789', // 17 digits
      '202405151234567890', // 18 digits
      '2024051512345678901', // 19 digits
    ];
    for (const c of cases) {
      const out = redactPiiFromString(`audit:${c} done`);
      expect(out).toBe(`audit:${c} done`);
      expect(out).not.toContain('[NIDA_ID]');
    }
  });

  it('DOES redact a canonical hyphenated NIDA id (4-4-5-7)', () => {
    // 1985-0101-12345-6789012 — the canonical Tanzania NIDA layout.
    const input = 'Tenant id 1985-0101-12345-6789012 belongs to John.';
    const out = redactPiiFromString(input);
    expect(out).toContain('[NIDA_ID]');
    expect(out).not.toContain('1985-0101-12345-6789012');
  });

  it('DOES redact a 20-digit contiguous NIDA id', () => {
    // 19850101 1234 5 6789012 — same digits, no separators.
    const input = 'NIDA 19850101123456789012 stored.';
    const out = redactPiiFromString(input);
    expect(out).toContain('[NIDA_ID]');
    expect(out).not.toContain('19850101123456789012');
  });

  it('redacts NIDA inside CSV-like rows without eating neighbouring digits', () => {
    const input = 'name,id,phone\nAsha,1985-0101-12345-6789012,+255712345678';
    const out = redactPiiFromString(input);
    expect(out).toContain('[NIDA_ID]');
    expect(out).toContain('[PHONE]');
    expect(out).not.toContain('1985-0101-12345-6789012');
  });

  it('does not redact partial / wrong-length NIDA candidates', () => {
    // Short of 20 digits, no hyphenation — should NOT match.
    const cases = [
      '1985-0101-12345-678', // 19-char total, hyphenated short
      '19850101-1234-56789', // wrong grouping (8-4-5)
      '1985 0101 12345 6789012', // spaces (old loose pattern)
      '19850101-12345-6789012', // 8-5-7 wrong grouping
    ];
    for (const c of cases) {
      const out = redactPiiFromString(c);
      expect(out).toBe(c);
      expect(out).not.toContain('[NIDA_ID]');
    }
  });
});

describe('redactPiiFromString — other PII still works', () => {
  it('still redacts Kenya KRA PIN tokens', () => {
    const out = redactPiiFromString('PIN A123456789B issued.');
    expect(out).toContain('<kra-pin:redacted>');
  });

  it('still redacts +255 Tanzania mobile numbers', () => {
    const out = redactPiiFromString('Call +255712345678 now.');
    expect(out).toContain('[PHONE]');
    expect(out).not.toContain('+255712345678');
  });

  it('still redacts email addresses', () => {
    const out = redactPiiFromString('Contact owner@example.com today.');
    expect(out).toContain('[EMAIL]');
    expect(out).not.toContain('owner@example.com');
  });
});
