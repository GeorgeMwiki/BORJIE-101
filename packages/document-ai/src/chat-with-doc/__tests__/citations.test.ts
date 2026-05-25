import { describe, expect, it } from 'vitest';
import { parseAnswerWithCitations, formatCitationMarker } from '../citations.js';

describe('parseAnswerWithCitations', () => {
  it('extracts and de-duplicates citations and rewrites with numbered refs', () => {
    const raw =
      'The rent is TZS 1,250,000 [doc:d1#p1:b-3:"Monthly Rent: TZS 1,250,000"] and due monthly [doc:d1#p1:b-3:"Monthly Rent: TZS 1,250,000"].';
    const parsed = parseAnswerWithCitations(raw);
    expect(parsed.cleanAnswer).toContain('[1]');
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0]!.docId).toBe('d1');
    expect(parsed.citations[0]!.pageNumber).toBe(1);
    expect(parsed.citations[0]!.blockId).toBe('b-3');
  });

  it('returns an empty list when no markers are present', () => {
    const parsed = parseAnswerWithCitations('No citations here at all.');
    expect(parsed.citations).toEqual([]);
    expect(parsed.cleanAnswer).toBe('No citations here at all.');
  });

  it('round-trips through formatCitationMarker', () => {
    const original = {
      docId: 'doc-abc',
      pageNumber: 2,
      blockId: 'b-7',
      quote: 'Tenant signs here',
    };
    const marker = formatCitationMarker(original);
    const parsed = parseAnswerWithCitations(`Look: ${marker} done.`);
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0]).toEqual(original);
  });
});
