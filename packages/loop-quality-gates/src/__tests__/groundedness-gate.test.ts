import { describe, it, expect } from 'vitest';
import { groundednessGate } from '../gates/groundedness-gate.js';

describe('groundedness-gate', () => {
  it('passes when every claim has a resolvable citation', () => {
    const idx = new Map([
      ['c1', { url: 'https://tra.go.tz/royalty', title: 'TRA Schedule' }],
    ]);
    const r = groundednessGate({
      claims: [{ id: 'k1', text: 'royalty 3%', citationIds: ['c1'] }],
      citationIndex: idx,
    });
    expect(r.pass).toBe(true);
    expect(r.signal.score).toBe(1.0);
    expect(r.signal.signal).toBe('groundedness');
  });

  it('passes when the output opts into no-factual-claims', () => {
    const r = groundednessGate({
      claims: [],
      citationIndex: new Map(),
      noFactualClaims: true,
    });
    expect(r.pass).toBe(true);
  });

  it('fails when zero claims and no opt-out', () => {
    const r = groundednessGate({
      claims: [],
      citationIndex: new Map(),
    });
    expect(r.pass).toBe(false);
    expect(r.signal.score).toBe(0.0);
  });

  it('fails when a claim has no citations and reports the failing claim id', () => {
    const r = groundednessGate({
      claims: [
        { id: 'k1', text: 'royalty 3%', citationIds: [] },
        { id: 'k2', text: 'tax due Friday', citationIds: ['c1'] },
      ],
      citationIndex: new Map([['c1', { url: 'x' }]]),
    });
    expect(r.pass).toBe(false);
    // Half the claims are grounded; partial-fail score = 0.5.
    expect(r.signal.score).toBeCloseTo(0.5, 5);
    const failingIds = (r.signal.evidence as { failingClaimIds: string[] })
      .failingClaimIds;
    expect(failingIds).toContain('k1');
  });

  it('fails when a claim cites an unresolved citation_id', () => {
    const r = groundednessGate({
      claims: [{ id: 'k1', text: 'royalty 3%', citationIds: ['c-missing'] }],
      citationIndex: new Map(),
    });
    expect(r.pass).toBe(false);
    const unresolved = (
      r.signal.evidence as { unresolvedCitations: string[] }
    ).unresolvedCitations;
    expect(unresolved).toContain('c-missing');
  });
});
