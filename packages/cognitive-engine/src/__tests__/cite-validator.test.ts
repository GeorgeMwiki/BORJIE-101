import { describe, expect, it } from 'vitest';
import { validateCitations } from '../grounding/cite-validator.js';
import type { SpanCitation } from '../types.js';

const realCit: SpanCitation = {
  citationId: 'cit_real',
  source: 'tumemadini',
  title: 'Mining Act §12',
};

describe('validateCitations', () => {
  it('passes a claim that has a resolvable citation', () => {
    const text = 'The royalty rate is 7% [cit_real].';
    const r = validateCitations(text, [realCit]);
    expect(r.decision).toBe('pass');
    expect(r.confidence_tier_reduction).toBe(0);
  });

  it('rewrites a single uncited claim with confidence drop of one tier when claim count is high', () => {
    // 1 uncited out of 5 claims = 20% — equals the threshold but does not exceed it.
    const text = [
      'The royalty rate is 7% [cit_real].',
      'Production hit 12,000 oz [cit_real].',
      'The deal closed in 2024 [cit_real].',
      'Profit was USD 4.5m [cit_real].',
      'Compliance fines totalled KES 2.1m.',
    ].join('\n');
    const r = validateCitations(text, [realCit]);
    expect(r.decision).toBe('rewrite');
    expect(r.confidence_tier_reduction).toBe(1);
    expect(r.rewritten_text).toContain('[unverified — please confirm]');
  });

  it('rejects when more than 20% of claims are uncited', () => {
    const text =
      'The royalty rate is 7%. Production hit 12,000 oz. The deal closed in 2024. Compliance fines totalled USD 1.5m.';
    const r = validateCitations(text, []);
    expect(r.decision).toBe('reject');
    expect(r.confidence_tier_reduction).toBe(2);
  });

  it('rejects FAKED citations (id points to nothing)', () => {
    const text = 'The royalty rate is 7% [cit_fake].';
    const r = validateCitations(text, [realCit]);
    expect(r.decision).toBe('reject');
    expect(r.sentences.some((s) => s.verdict === 'faked')).toBe(true);
    expect(r.rewritten_text).not.toContain('[cit_fake]');
  });

  it('skips opinion + hedge sentences from claim validation', () => {
    const text = 'I recommend we review compliance.\nWe might want to look at this.';
    const r = validateCitations(text, []);
    expect(r.decision).toBe('pass');
  });
});
