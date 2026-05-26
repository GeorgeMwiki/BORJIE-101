/**
 * Tests for the bilingual mining-domain glossary (Wave 19H).
 */

import { describe, it, expect } from 'vitest';
import {
  createGlossaryLookup,
  MINING_TERMS_SEED,
} from '../index.js';

describe('mining-domain glossary', () => {
  it('seeds at least 50 entries', () => {
    expect(MINING_TERMS_SEED.length).toBeGreaterThanOrEqual(50);
  });

  it('cites a primary source on every entry', () => {
    for (const t of MINING_TERMS_SEED) {
      expect(t.citation.url).toMatch(/^https?:\/\//);
      expect(t.citation.title.length).toBeGreaterThan(0);
      expect(t.citation.accessedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('resolves Swahili → English: mrabaha → royalty', () => {
    const lookup = createGlossaryLookup();
    const term = lookup.bySwahili('mrabaha');
    expect(term).not.toBeNull();
    expect(term?.enEquivalent).toBe('royalty');
    expect(term?.domain).toBe('royalty');
  });

  it('resolves English → Swahili: royalty → mrabaha', () => {
    const lookup = createGlossaryLookup();
    const term = lookup.byEnglish('royalty');
    expect(term?.term).toBe('mrabaha');
  });

  it('lists all entries in a domain', () => {
    const lookup = createGlossaryLookup();
    const licensing = lookup.byDomain('licensing');
    expect(licensing.length).toBeGreaterThanOrEqual(5);
    for (const t of licensing) {
      expect(t.domain).toBe('licensing');
    }
  });

  it('prefers register-matched entries when requested', () => {
    const lookup = createGlossaryLookup();
    // pesa exists as `colloquial`; fedha exists as `formal`. Both
    // map to "money" / "currency".
    const formal = lookup.byEnglish('currency / money', 'formal');
    expect(formal?.term).toBe('fedha');
  });
});
