import { describe, expect, it } from 'vitest';
import { assembleBrief, computeHash, verifyBriefHash, canonicalJson } from '../brief-assembler.js';
import type { VerifiedHypothesis } from '../hypothesis-verifier.js';
import type { RecommendedAction } from '../types.js';

const NOW = new Date('2026-05-22T06:00:00.000Z');
const PERIOD_START = new Date('2026-05-15T00:00:00.000Z');
const PERIOD_END = new Date('2026-05-22T00:00:00.000Z');

const SCOPE = { modules: ['ESTATE'], timeWindow: 'P7D', focusEntities: [] };

function verified(
  overrides: Partial<VerifiedHypothesis> = {},
): VerifiedHypothesis {
  return {
    hypothesis: {
      kind: 'risk',
      title: 'Lease 4B expiring soon',
      description: 'The lease for unit 4B ends in 14 days.',
      severity: 'HIGH',
      evidenceRefs: [{ kind: 'entity', id: 'ent_lease_4b' }],
    },
    evidence: [
      {
        id: 'ent_lease_4b',
        kind: 'entity',
        snippet: 'Lease 4B end_date=2026-06-05',
        score: 0.9,
        source: 'bm25',
      },
    ],
    judgeScore: 0.85,
    ...overrides,
  };
}

describe('assembleBrief', () => {
  it('produces a valid brief with risks + citations', () => {
    const brief = assembleBrief({
      tenantId: 'ten_trc',
      personaId: 'pers_dg',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      scope: SCOPE,
      hypotheses: [verified()],
      recommendedActions: [],
      actionSourceMap: [],
      locale: 'en',
      generatorVersion: 'v1',
      prevHash: null,
      generatedAt: NOW,
    });
    expect(brief.risks).toHaveLength(1);
    expect(brief.risks[0]!.citationIndices.length).toBeGreaterThan(0);
    expect(brief.citations.length).toBeGreaterThan(0);
    expect(brief.hash).toBeTruthy();
  });

  it('throws when a hypothesis ends up uncited', () => {
    const uncited = verified({
      hypothesis: {
        kind: 'risk',
        title: 'X',
        description: 'Y',
        severity: 'HIGH',
        evidenceRefs: [],
      },
      evidence: [],
    });
    expect(() =>
      assembleBrief({
        tenantId: 't',
        personaId: 'p',
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        scope: SCOPE,
        hypotheses: [uncited],
        recommendedActions: [],
        actionSourceMap: [],
        locale: 'en',
        generatorVersion: 'v1',
        prevHash: null,
      }),
    ).toThrow();
  });

  it('deduplicates citations across multiple hypotheses', () => {
    // Two hypotheses both cite the same entity — citations[] should have one row, not two.
    const h1 = verified({
      hypothesis: {
        kind: 'risk',
        title: 'A',
        description: 'AA',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'entity', id: 'ent_shared' }],
      },
      evidence: [
        {
          id: 'ent_shared',
          kind: 'entity',
          snippet: 'shared',
          score: 0.9,
          source: 'bm25',
        },
      ],
    });
    const h2 = verified({
      hypothesis: {
        kind: 'gap',
        title: 'B',
        description: 'BB',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'entity', id: 'ent_shared' }],
      },
      evidence: [
        {
          id: 'ent_shared',
          kind: 'entity',
          snippet: 'shared',
          score: 0.9,
          source: 'bm25',
        },
      ],
    });
    const brief = assembleBrief({
      tenantId: 't',
      personaId: 'p',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      scope: SCOPE,
      hypotheses: [h1, h2],
      recommendedActions: [],
      actionSourceMap: [],
      locale: 'en',
      generatorVersion: 'v1',
      prevHash: null,
    });
    expect(brief.citations).toHaveLength(1);
  });

  it('chains hashes via prevHash', () => {
    const a = assembleBrief({
      tenantId: 't',
      personaId: 'p',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      scope: SCOPE,
      hypotheses: [verified()],
      recommendedActions: [],
      actionSourceMap: [],
      locale: 'en',
      generatorVersion: 'v1',
      prevHash: null,
    });
    const b = assembleBrief({
      tenantId: 't',
      personaId: 'p',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      scope: SCOPE,
      hypotheses: [verified({ hypothesis: { ...verified().hypothesis, title: 'Different' } })],
      recommendedActions: [],
      actionSourceMap: [],
      locale: 'en',
      generatorVersion: 'v1',
      prevHash: a.hash,
    });
    expect(b.prevHash).toBe(a.hash);
    expect(b.hash).not.toBe(a.hash);
  });

  it('attaches recommendedActions when source map has citations', () => {
    const action: RecommendedAction = {
      title: 'Renew lease',
      targetModule: 'ESTATE',
      action: 'schedule_renewal_negotiation',
      payload: {},
      confidence: 0.7,
      citationIndices: [],
      requiresApproval: true,
    };
    const brief = assembleBrief({
      tenantId: 't',
      personaId: 'p',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      scope: SCOPE,
      hypotheses: [verified()],
      recommendedActions: [action],
      actionSourceMap: [{ hypothesisIndex: 0 }],
      locale: 'en',
      generatorVersion: 'v1',
      prevHash: null,
    });
    expect(brief.recommendedActions).toHaveLength(1);
    expect(brief.recommendedActions[0]!.citationIndices.length).toBeGreaterThan(0);
  });

  it('drops recommendedActions whose source has no citations', () => {
    const action: RecommendedAction = {
      title: 'Orphan',
      targetModule: 'X',
      action: 'do',
      payload: {},
      confidence: 0.1,
      citationIndices: [],
      requiresApproval: false,
    };
    const brief = assembleBrief({
      tenantId: 't',
      personaId: 'p',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      scope: SCOPE,
      hypotheses: [verified()],
      recommendedActions: [action],
      actionSourceMap: [{ hypothesisIndex: 99 }], // out of range
      locale: 'en',
      generatorVersion: 'v1',
      prevHash: null,
    });
    expect(brief.recommendedActions).toHaveLength(0);
  });
});

describe('canonicalJson', () => {
  it('produces stable output regardless of key order', () => {
    const a = canonicalJson({ b: 2, a: 1 });
    const b = canonicalJson({ a: 1, b: 2 });
    expect(a).toBe(b);
  });
  it('handles arrays and nesting', () => {
    const out = canonicalJson({ a: [1, 2, 3], b: { z: 9, y: 8 } });
    expect(out).toBe('{"a":[1,2,3],"b":{"y":8,"z":9}}');
  });
});

describe('verifyBriefHash', () => {
  it('returns true for an intact brief', () => {
    const brief = assembleBrief({
      tenantId: 't',
      personaId: 'p',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      scope: SCOPE,
      hypotheses: [verified()],
      recommendedActions: [],
      actionSourceMap: [],
      locale: 'en',
      generatorVersion: 'v1',
      prevHash: null,
    });
    expect(verifyBriefHash(brief)).toBe(true);
  });
  it('returns false when the payload was tampered with', () => {
    const brief = assembleBrief({
      tenantId: 't',
      personaId: 'p',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      scope: SCOPE,
      hypotheses: [verified()],
      recommendedActions: [],
      actionSourceMap: [],
      locale: 'en',
      generatorVersion: 'v1',
      prevHash: null,
    });
    // Tamper with the brief.
    const tampered = {
      ...brief,
      gaps: [
        {
          title: 'Injected',
          description: 'Not from the engine',
          severity: 'HIGH' as const,
          citationIndices: [0],
        },
      ],
    };
    expect(verifyBriefHash(tampered)).toBe(false);
  });
});

describe('computeHash', () => {
  it('is deterministic', () => {
    const a = computeHash('prev', { x: 1 });
    const b = computeHash('prev', { x: 1 });
    expect(a).toBe(b);
  });
  it('changes when prevHash changes', () => {
    const a = computeHash('prev_a', { x: 1 });
    const b = computeHash('prev_b', { x: 1 });
    expect(a).not.toBe(b);
  });
});
