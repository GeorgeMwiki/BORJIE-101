/**
 * Citation builder — span citation + derive citation id tests.
 */

import { describe, expect, it } from 'vitest';

import {
  buildSpanCitation,
  deriveCitationId,
} from '../citations/citation-builder.js';
import type { ResearchArtifact } from '../types.js';

function artifact(overrides: Partial<ResearchArtifact> = {}): ResearchArtifact {
  return {
    id: 'art_1',
    step_id: 'step_1',
    source_kind: 'web',
    source_uri: 'https://www.tumemadini.go.tz/x',
    source_class: 'tz_official',
    retrieved_at: '2026-01-01T00:00:00.000Z',
    content:
      'The royalty on gold is 6% of gross value. The royalty on copper is 4%. Other minerals carry a 3% royalty.',
    excerpt: '',
    title: 'Tanzania royalty rates',
    extracted_entities: [],
    quality_score: 0.95,
    bias_flags: [],
    citation_id: 'cit_test',
    audit_hash: 'a'.repeat(64),
    tool_name: 'tavily-search',
    cost_usd_cents: 1,
    ...overrides,
  };
}

describe('buildSpanCitation', () => {
  it('selects the sentence with highest Jaccard overlap', () => {
    const cite = buildSpanCitation({
      artifact: artifact(),
      claim_text: 'royalty on copper',
    });
    expect(cite.quotedSpan).toContain('copper');
    expect(cite.overlap).toBeGreaterThan(0);
    expect(cite.kind).toBe('web');
  });

  it('falls back to whole content on low overlap', () => {
    const cite = buildSpanCitation({
      artifact: artifact(),
      claim_text: 'something completely unrelated to royalty',
    });
    expect(cite.quotedSpan.length).toBeGreaterThan(0);
  });

  it('handles empty content gracefully', () => {
    const a = artifact({ content: '' });
    const cite = buildSpanCitation({ artifact: a, claim_text: 'x' });
    expect(cite.quotedSpan).toBe('');
  });

  it('preserves citationId from the artifact', () => {
    const cite = buildSpanCitation({
      artifact: artifact({ citation_id: 'my_cit' }),
      claim_text: 'royalty',
    });
    expect(cite.citationId).toBe('my_cit');
  });

  it('startOffset/endOffset slice exactly matches quotedSpan', () => {
    const a = artifact();
    const cite = buildSpanCitation({
      artifact: a,
      claim_text: 'gold royalty 6%',
    });
    expect(a.content.slice(cite.startOffset, cite.endOffset)).toBe(
      cite.quotedSpan,
    );
  });
});

describe('deriveCitationId', () => {
  it('is stable for the same URI', () => {
    const a = deriveCitationId('https://tumemadini.go.tz/x');
    const b = deriveCitationId('https://tumemadini.go.tz/x');
    expect(a).toBe(b);
    expect(a).toMatch(/^cit_[a-f0-9]{8}$/);
  });

  it('differs for different URIs', () => {
    const a = deriveCitationId('https://x.com/1');
    const b = deriveCitationId('https://x.com/2');
    expect(a).not.toBe(b);
  });

  it('appends suffix when provided', () => {
    const a = deriveCitationId('https://x.com', 'art_1');
    expect(a).toContain('art_1');
  });
});
