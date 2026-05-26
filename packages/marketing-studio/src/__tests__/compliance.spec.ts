/**
 * Compliance tests — claim citation, forbidden, disclaimer, geo.
 */

import { describe, it, expect } from 'vitest';
import {
  findUncitedClaims,
  claimsAllCited,
  scanForbiddenPhrases,
  findMissingDisclaimers,
  findGeoRestrictionFlags,
} from '../compliance/index.js';
import type { SpanCitation } from '../types.js';

const CITATIONS: ReadonlyArray<SpanCitation> = Object.freeze([
  Object.freeze({
    id: 'bot-2025-q3',
    claim: 'BoT Q3',
    source: { kind: 'research_result' as const, ref: 'bot:2025:q3' },
  }),
]);

describe('claims validator', () => {
  it('flags numeric claims without a [cite:...] tag', () => {
    const body = 'Tanzania mining grew 13% YoY.';
    const result = findUncitedClaims(body, CITATIONS);
    expect(result.length).toBeGreaterThan(0);
    expect(claimsAllCited(body, CITATIONS)).toBe(false);
  });

  it('passes when numeric claims are cited', () => {
    const body = 'Tanzania mining grew 13% YoY in 2025 [cite:bot-2025-q3].';
    const result = findUncitedClaims(body, CITATIONS);
    expect(result).toHaveLength(0);
    expect(claimsAllCited(body, CITATIONS)).toBe(true);
  });

  it('flags claims with unknown cite ids', () => {
    const body = 'Tanzania mining grew 13% [cite:unknown-id].';
    const result = findUncitedClaims(body, CITATIONS);
    expect(result.some((c) => c.reason === 'unknown_cite_id')).toBe(true);
  });
});

describe('forbidden phrase scanner', () => {
  it('catches default forbidden phrases case-insensitively', () => {
    const body = 'This is a Risk-Free opportunity.';
    const found = scanForbiddenPhrases({ body });
    expect(found).toContain('risk-free');
  });

  it('catches campaign-specific forbidden phrases', () => {
    const body = 'sure thing yields ahead';
    const found = scanForbiddenPhrases({
      body,
      extra_forbidden: ['guaranteed yields'],
    });
    expect(found).toContain('sure thing');
  });
});

describe('disclaimer checker', () => {
  it('reports missing required disclaimers', () => {
    const body = 'Borjie quarterly update.';
    const missing = findMissingDisclaimers({
      body,
      required_disclaimers: ['Past performance does not predict future results.'],
    });
    expect(missing).toHaveLength(1);
  });

  it('passes whitespace-tolerant matches', () => {
    const body = 'Notes:  past   performance does NOT predict future results.';
    const missing = findMissingDisclaimers({
      body,
      required_disclaimers: ['Past performance does not predict future results.'],
    });
    expect(missing).toHaveLength(0);
  });
});

describe('geo restriction filter', () => {
  it('flags forward-looking returns claims for restricted jurisdictions', () => {
    const body = 'expected returns of 18% projected.';
    const flags = findGeoRestrictionFlags({
      body,
      geo_restrictions: ['US', 'EU'],
    });
    expect(flags.length).toBeGreaterThan(0);
  });

  it('returns empty when restrictions are empty', () => {
    const body = 'expected returns of 18% projected.';
    const flags = findGeoRestrictionFlags({ body, geo_restrictions: [] });
    expect(flags).toHaveLength(0);
  });
});
