/**
 * Persist-boundary CoT scrub — unit tests.
 *
 * Verifies:
 *   - All regional PII patterns fire (phone, KRA PIN, NIDA, email).
 *   - All CoT-specific patterns fire (M-Pesa txn, anthropic url, API
 *     keys, model names).
 *   - Idempotence: running twice returns the same output.
 *   - Category list is sorted + de-duplicated.
 *   - Empty / null input is safe.
 */

import { describe, it, expect } from 'vitest';
import {
  scrubCotForPersist,
  buildCotScrubAuditEnvelope,
} from '../pii-scrub-cot.js';

describe('scrubCotForPersist — regional PII coverage', () => {
  it('redacts a Tanzania mobile (+255)', () => {
    const out = scrubCotForPersist('Call +255 712 345 678 for the deposit.');
    expect(out.scrubbed).not.toContain('255');
    expect(out.scrubbed).toContain('[redacted-phone]');
    expect(out.categories).toContain('phone-tz');
  });

  it('redacts a Kenya mobile (+254)', () => {
    const out = scrubCotForPersist('Tenant rang on +254 700 111 222 last night.');
    expect(out.scrubbed).toContain('[redacted-phone]');
    expect(out.categories).toContain('phone-ke');
  });

  it('redacts a KRA PIN (P051234567Z shape)', () => {
    const out = scrubCotForPersist('Their KRA PIN is P051234567Z and ours differs.');
    expect(out.scrubbed).not.toContain('P051234567Z');
    expect(out.scrubbed).toContain('[redacted-kra-pin]');
    expect(out.categories).toContain('kra-pin');
  });

  it('redacts a Tanzania NIDA (20-char shape)', () => {
    const out = scrubCotForPersist('NIDA on file: 19850101-12345-12345-12.');
    expect(out.scrubbed).toContain('[redacted-nida]');
    expect(out.categories).toContain('nida-tz');
  });

  it('redacts an email address', () => {
    const out = scrubCotForPersist('Reply to landlord@example.co.tz directly.');
    expect(out.scrubbed).toContain('[redacted-email]');
    expect(out.categories).toContain('email');
  });
});

describe('scrubCotForPersist — CoT-specific patterns', () => {
  it('redacts an anthropic.com URL', () => {
    const out = scrubCotForPersist('Called https://api.anthropic.com/v1/messages with prompt.');
    expect(out.scrubbed).not.toContain('anthropic.com');
    expect(out.scrubbed).toContain('[redacted-model-url]');
    expect(out.categories).toContain('model-provider-url');
  });

  it('redacts an openai.com URL', () => {
    const out = scrubCotForPersist('Fallback to https://api.openai.com/v1/chat/completions next.');
    expect(out.scrubbed).toContain('[redacted-model-url]');
    expect(out.categories).toContain('model-provider-url');
  });

  it('redacts an sk-ant Anthropic API key', () => {
    const out = scrubCotForPersist('Token leak: sk-ant-api03-AAAABBBBCCCCDDDD1234EEEEFFFF.');
    expect(out.scrubbed).not.toContain('sk-ant-api03');
    expect(out.scrubbed).toContain('[redacted-api-key]');
    expect(out.categories).toContain('anthropic-key');
  });

  it('redacts a generic sk- API key', () => {
    const out = scrubCotForPersist('Old key sk-AAAABBBBCCCCDDDD1234EEEEFFFF was rotated.');
    expect(out.scrubbed).toContain('[redacted-api-key]');
    expect(out.categories).toContain('api-key-generic');
  });

  it('redacts an api_key= querystring', () => {
    const out = scrubCotForPersist('Used api_key=ZZZZAAAA9999BBBB7777CCCC in test.');
    expect(out.scrubbed).toContain('[redacted-api-key]');
    expect(out.categories).toContain('api-key-querystring');
  });

  it('redacts an MPESA-prefixed transaction ID', () => {
    const out = scrubCotForPersist('Got confirmation MPESAQ7X8Y2Z9A from payer.');
    expect(out.scrubbed).not.toContain('MPESAQ7X8Y2Z9A');
    expect(out.scrubbed).toContain('[redacted-mpesa-txn]');
    expect(out.categories).toContain('mpesa-txn');
  });

  it('redacts a Safaricom-shaped M-Pesa code via cue word', () => {
    const out = scrubCotForPersist('Confirmation: QJK12ABCDE — settled.');
    expect(out.scrubbed).toContain('[redacted-mpesa-txn]');
    expect(out.categories).toContain('mpesa-txn-saf');
  });

  it('redacts a claude-opus model id', () => {
    const out = scrubCotForPersist('Routed to claude-opus-4-7 for the critical turn.');
    expect(out.scrubbed).toContain('[redacted-model-name]');
    expect(out.categories).toContain('model-name');
  });

  it('redacts a gpt-4o model id', () => {
    const out = scrubCotForPersist('Fell back to gpt-4o-2024-11-20 after sonnet failed.');
    expect(out.scrubbed).toContain('[redacted-model-name]');
    expect(out.categories).toContain('model-name');
  });
});

describe('scrubCotForPersist — round-trip and safety', () => {
  it('is idempotent — running twice yields the same output', () => {
    const input = 'Email landlord@example.co.tz, key sk-AAAABBBBCCCCDDDD1234EEEE.';
    const once = scrubCotForPersist(input);
    const twice = scrubCotForPersist(once.scrubbed);
    expect(twice.scrubbed).toBe(once.scrubbed);
  });

  it('scrubbed output is still human-readable', () => {
    const out = scrubCotForPersist(
      'Tenant +255 712 345 678 paid via MPESAQ7X8Y2Z9A; called claude-opus-4-7.',
    );
    // The narrative survives — only the tokens themselves are redacted.
    expect(out.scrubbed).toMatch(/Tenant.*paid via.*called.*/);
    expect(out.scrubbed).toContain('[redacted-phone]');
    expect(out.scrubbed).toContain('[redacted-mpesa-txn]');
    expect(out.scrubbed).toContain('[redacted-model-name]');
  });

  it('returns sorted, de-duplicated categories', () => {
    const out = scrubCotForPersist(
      'Reach me on +255 712 345 678 or +255 700 111 222; also email a@b.co.',
    );
    // Two phone-tz hits collapse to one category entry.
    const phoneCount = out.categories.filter((c) => c === 'phone-tz').length;
    expect(phoneCount).toBe(1);
    // Categories are sorted.
    const sorted = [...out.categories].sort();
    expect(out.categories).toEqual(sorted);
  });

  it('null input returns empty result without throwing', () => {
    const out = scrubCotForPersist(null);
    expect(out.scrubbed).toBe('');
    expect(out.redactionCount).toBe(0);
    expect(out.categories).toHaveLength(0);
  });

  it('empty string returns empty result', () => {
    const out = scrubCotForPersist('');
    expect(out.scrubbed).toBe('');
    expect(out.redactionCount).toBe(0);
  });

  it('text with no PII passes through unchanged', () => {
    const benign = 'Rent for Unit 4B is due on the first.';
    const out = scrubCotForPersist(benign);
    expect(out.scrubbed).toBe(benign);
    expect(out.redactionCount).toBe(0);
    expect(out.categories).toHaveLength(0);
  });
});

describe('buildCotScrubAuditEnvelope', () => {
  it('produces a PII-free envelope', () => {
    const result = scrubCotForPersist('Email leak: a@b.co and key sk-AAAABBBBCCCCDDDD1234EEEE.');
    const env = buildCotScrubAuditEnvelope(result, {
      thoughtId: 'thg_1',
      tenantId: 'tnt_demo',
    });
    expect(env.thoughtId).toBe('thg_1');
    expect(env.tenantId).toBe('tnt_demo');
    expect(env.redactionCount).toBeGreaterThan(0);
    // No raw PII in the audit envelope.
    const serialised = JSON.stringify(env);
    expect(serialised).not.toContain('a@b.co');
    expect(serialised).not.toContain('sk-AAAA');
  });
});
