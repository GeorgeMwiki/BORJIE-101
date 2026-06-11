/**
 * Unit tests for the structured-document citation gate — every monetary
 * figure in a worksheet must be covered by a citation claim.
 */

import { describe, expect, it } from 'vitest';
import { verifyStructuredCitations } from '../structured-citation-gate.js';
import type { Citation } from '../../types.js';

const cite = (claim: string): Citation => ({
  id: claim,
  claim,
  source: { kind: 'computation', ref: 'assay:1' },
});

describe('verifyStructuredCitations', () => {
  it('passes when every money figure is covered by a claim', () => {
    const verdict = verifyStructuredCitations({
      text: 'Balance TZS 324,000,000.00 over TZS 1,824,000,000.00',
      citations: [cite('TZS 324,000,000.00'), cite('TZS 1,824,000,000.00')],
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.coveredClaims).toBe(2);
  });

  it('fails an uncovered figure', () => {
    const verdict = verifyStructuredCitations({
      text: 'Pay TZS 999,000,000.00 now',
      citations: [cite('TZS 1.00')],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.missing[0]?.reason).toBe('numeric-uncovered');
      expect(verdict.missing[0]?.fragment).toContain('999,000,000');
    }
  });

  it('normalises whitespace between doc and claim', () => {
    const verdict = verifyStructuredCitations({
      text: 'KES  1,000.00',
      citations: [cite('KES 1,000.00')],
    });
    expect(verdict.ok).toBe(true);
  });

  it('deduplicates repeated tokens (counts each once)', () => {
    const verdict = verifyStructuredCitations({
      text: 'TZS 100.00 then TZS 100.00 again',
      citations: [cite('TZS 100.00')],
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.coveredClaims).toBe(1);
  });

  it('passes a document with no money figures (nothing to cover)', () => {
    const verdict = verifyStructuredCitations({
      text: 'A worksheet with only labels',
      citations: [],
    });
    expect(verdict.ok).toBe(true);
  });
});
