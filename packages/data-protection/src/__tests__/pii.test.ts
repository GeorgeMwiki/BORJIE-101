/**
 * DP-03 — hybrid PII detection + redaction tests.
 *
 * Proves:
 *   - regex tier catches structured IDs (phone, email, NIDA, TIN, card, IP).
 *   - NER port catches free-text PERSON the regex cannot; union is merged.
 *   - NER-down degrades to regex-only (IDs still stripped, no throw).
 *   - redaction is reversible (placeholder ↔ original) + consistent.
 *   - the sync redactor + deep-object redactor strip PII for the log path.
 */

import { describe, it, expect } from 'vitest';
import {
  createPiiDetector,
  detectRegexSpans,
  placeholderFor,
  type PiiAnalyzerPort,
  type PiiSpan,
} from '../pii/detector.js';
import {
  applyRedaction,
  restoreRedaction,
  redactPiiSync,
  redactPii,
  redactObject,
} from '../pii/redactor.js';

const SENTENCE =
  'Call John Mwangi at +255712345678, NIDA 19900101-12345-00001-23, email john@mine.co.tz';

/** Fake Presidio-style sidecar: finds "John Mwangi" as a PERSON. */
const personAnalyzer: PiiAnalyzerPort = {
  async analyze({ text }) {
    const name = 'John Mwangi';
    const idx = text.indexOf(name);
    if (idx < 0) return [];
    const span: PiiSpan = {
      type: 'PERSON',
      start: idx,
      end: idx + name.length,
      text: name,
      score: 0.92,
      source: 'ner',
    };
    return [span];
  },
};

describe('detectRegexSpans', () => {
  it('catches phone, NIDA, and email in free text', () => {
    const spans = detectRegexSpans(SENTENCE);
    const types = new Set(spans.map((s) => s.type));
    expect(types.has('PHONE')).toBe(true);
    expect(types.has('NATIONAL_ID')).toBe(true);
    expect(types.has('EMAIL')).toBe(true);
    // PERSON is NOT catchable by regex.
    expect(types.has('PERSON')).toBe(false);
  });

  it('validates credit cards with Luhn', () => {
    // 4111 1111 1111 1111 is a valid Visa test number (Luhn-passes).
    const ok = detectRegexSpans('card 4111 1111 1111 1111');
    expect(ok.some((s) => s.type === 'CREDIT_CARD')).toBe(true);
    // A 16-digit run that fails Luhn is not a card.
    const bad = detectRegexSpans('id 1234 5678 9012 3456');
    expect(bad.some((s) => s.type === 'CREDIT_CARD')).toBe(false);
  });
});

describe('createPiiDetector — hybrid', () => {
  it('unions regex IDs with NER PERSON spans', async () => {
    const detector = createPiiDetector({ analyzer: personAnalyzer });
    const spans = await detector.detect(SENTENCE);
    const types = new Set(spans.map((s) => s.type));
    expect(types.has('PHONE')).toBe(true);
    expect(types.has('NATIONAL_ID')).toBe(true);
    expect(types.has('PERSON')).toBe(true);
  });

  it('degrades to regex-only when the NER port throws', async () => {
    const flaky: PiiAnalyzerPort = {
      async analyze() {
        throw new Error('sidecar unreachable');
      },
    };
    const detector = createPiiDetector({ analyzer: flaky });
    const spans = await detector.detect(SENTENCE);
    const types = new Set(spans.map((s) => s.type));
    // PERSON is missed (NER down) BUT the structured IDs are still stripped.
    expect(types.has('PERSON')).toBe(false);
    expect(types.has('PHONE')).toBe(true);
    expect(types.has('NATIONAL_ID')).toBe(true);
  });

  it('detectSync is regex-only and synchronous', () => {
    const detector = createPiiDetector({ analyzer: personAnalyzer });
    const spans = detector.detectSync(SENTENCE);
    expect(spans.every((s) => s.source === 'regex')).toBe(true);
  });
});

describe('redaction', () => {
  it('redacts every detected span and is reversible', async () => {
    const detector = createPiiDetector({ analyzer: personAnalyzer });
    const spans = await detector.detect(SENTENCE);
    const result = applyRedaction(SENTENCE, spans, 'tenant-1');
    // No raw PII remains.
    expect(result.redacted).not.toContain('+255712345678');
    expect(result.redacted).not.toContain('19900101-12345-00001-23');
    expect(result.redacted).not.toContain('John Mwangi');
    expect(result.redacted).toContain('[PII:');
    // Reversible.
    const restored = restoreRedaction(result.redacted, result.mappings);
    expect(restored).toBe(SENTENCE);
  });

  it('uses a stable placeholder for the same (tenant,type,value)', () => {
    const a = placeholderFor('tenant-1', { type: 'PHONE', text: '+255712345678' });
    const b = placeholderFor('tenant-1', { type: 'PHONE', text: '+255712345678' });
    const other = placeholderFor('tenant-2', { type: 'PHONE', text: '+255712345678' });
    expect(a).toBe(b);
    expect(a).not.toBe(other); // tenant-scoped
  });

  it('redactPiiSync strips structured IDs for the Pino path', () => {
    const out = redactPiiSync('contact john@mine.co.tz / +255712345678');
    expect(out).not.toContain('john@mine.co.tz');
    expect(out).not.toContain('+255712345678');
    expect(out).toContain('[PII:EMAIL:');
  });

  it('redactObject deep-redacts a structured log payload immutably', () => {
    const payload = {
      msg: 'kyc note',
      buyer: { name: 'n/a', phone: '+255712345678', nested: ['email a@b.co'] },
      count: 3,
    };
    const redacted = redactObject(payload, 'tenant-1');
    expect(redacted.buyer.phone).not.toContain('+255712345678');
    expect(redacted.buyer.nested[0]).not.toContain('a@b.co');
    expect(redacted.count).toBe(3);
    // Immutability: the original is untouched.
    expect(payload.buyer.phone).toBe('+255712345678');
  });

  it('redactPii (async) returns the reversible mapping', async () => {
    const result = await redactPii(SENTENCE, 'tenant-1');
    expect(result.spans.length).toBeGreaterThan(0);
    expect(restoreRedaction(result.redacted, result.mappings)).toBe(SENTENCE);
  });
});
