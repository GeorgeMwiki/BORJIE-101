import { describe, expect, it } from 'vitest';
import { runStakesAwareDebateOnBrief } from '../debate.js';
import type { DebatePort } from '../debate.js';
import type { VerifiedHypothesis } from '../hypothesis-verifier.js';

function verified(severity: VerifiedHypothesis['hypothesis']['severity']): VerifiedHypothesis {
  return {
    hypothesis: {
      kind: 'risk',
      title: `Severity ${severity}`,
      description: 'D',
      severity,
      evidenceRefs: [],
    },
    evidence: [],
    judgeScore: 0.8,
  };
}

const KEEP_DEBATE: DebatePort = {
  async debate() {
    return {
      verdict: 'keep',
      synthesisedNote: 'agreed',
      tokenCostMicros: 100,
    };
  },
};

const DROP_DEBATE: DebatePort = {
  async debate() {
    return { verdict: 'drop', synthesisedNote: 'too speculative', tokenCostMicros: 80 };
  },
};

const SOFTEN_DEBATE: DebatePort = {
  async debate() {
    return {
      verdict: 'soften',
      softenedSeverity: 'MEDIUM',
      synthesisedNote: 'less critical',
      tokenCostMicros: 90,
    };
  },
};

describe('runStakesAwareDebateOnBrief', () => {
  it('skips debate for LOW + MEDIUM severity', async () => {
    const r = await runStakesAwareDebateOnBrief({
      tenantId: 't',
      survivors: [verified('LOW'), verified('MEDIUM')],
      debatePort: {
        async debate() {
          throw new Error('should not be called');
        },
      },
    });
    expect(r.survivors).toHaveLength(2);
    expect(r.dropped).toHaveLength(0);
    expect(r.totalCostMicros).toBe(0);
  });

  it('keeps HIGH severity when debate says keep', async () => {
    const r = await runStakesAwareDebateOnBrief({
      tenantId: 't',
      survivors: [verified('HIGH')],
      debatePort: KEEP_DEBATE,
    });
    expect(r.survivors).toHaveLength(1);
    expect(r.survivors[0]!.debateNote).toBe('agreed');
    expect(r.totalCostMicros).toBe(100);
  });

  it('drops HIGH severity when debate says drop', async () => {
    const r = await runStakesAwareDebateOnBrief({
      tenantId: 't',
      survivors: [verified('CRITICAL')],
      debatePort: DROP_DEBATE,
    });
    expect(r.survivors).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
  });

  it('softens severity when debate says soften', async () => {
    const r = await runStakesAwareDebateOnBrief({
      tenantId: 't',
      survivors: [verified('HIGH')],
      debatePort: SOFTEN_DEBATE,
    });
    expect(r.survivors).toHaveLength(1);
    expect(r.survivors[0]!.hypothesis.severity).toBe('MEDIUM');
  });

  it('handles debate failure conservatively (keep + note)', async () => {
    const r = await runStakesAwareDebateOnBrief({
      tenantId: 't',
      survivors: [verified('HIGH')],
      debatePort: {
        async debate() {
          throw new Error('debate down');
        },
      },
    });
    expect(r.survivors).toHaveLength(1);
    expect(r.survivors[0]!.debateNote).toContain('Debate runner unavailable');
  });

  it('respects custom stakes threshold', async () => {
    const r = await runStakesAwareDebateOnBrief({
      tenantId: 't',
      survivors: [verified('CRITICAL'), verified('HIGH')],
      debatePort: KEEP_DEBATE,
      stakesThreshold: 'CRITICAL',
    });
    // Only CRITICAL hit debate; HIGH passes through.
    expect(r.totalCostMicros).toBe(100);
    expect(r.survivors).toHaveLength(2);
  });
});
