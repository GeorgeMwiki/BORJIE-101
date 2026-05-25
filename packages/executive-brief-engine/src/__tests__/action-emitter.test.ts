import { describe, expect, it } from 'vitest';
import { emitRecommendedActions } from '../action-emitter.js';
import type { RoutingRulesPort } from '../action-emitter.js';
import type { VerifiedHypothesis } from '../hypothesis-verifier.js';

const NULL_PORT: RoutingRulesPort = {
  async lookup() {
    return null;
  },
};

function verified(
  overrides: Partial<VerifiedHypothesis['hypothesis']> = {},
): VerifiedHypothesis {
  return {
    hypothesis: {
      kind: 'risk',
      title: 'Lease 4B expiring soon',
      description: 'Lease expires in 14 days.',
      severity: 'HIGH',
      evidenceRefs: [{ kind: 'entity', id: 'ent_lease' }],
      ...overrides,
    },
    evidence: [],
    judgeScore: 0.8,
  };
}

describe('emitRecommendedActions', () => {
  it('uses tenant routing rule when available', async () => {
    const r = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [verified()],
      routingRules: {
        async lookup() {
          return {
            moduleTemplateId: 'ESTATE',
            action: 'schedule_renewal_negotiation',
            payloadTemplate: { foo: 'bar' },
            minConfidence: 0.5,
            hitlRequired: true,
          };
        },
      },
    });
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]!.targetModule).toBe('ESTATE');
    expect(r.actions[0]!.action).toBe('schedule_renewal_negotiation');
    expect(r.actions[0]!.requiresApproval).toBe(true);
  });

  it('falls back to built-in matrix when no tenant rule', async () => {
    const r = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [verified()],
      routingRules: NULL_PORT,
    });
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]!.targetModule).toBe('ESTATE');
    expect(r.actions[0]!.action).toBe('schedule_renewal_negotiation');
  });

  it('matches arrears risk to FINANCE.open_arrears_follow_up', async () => {
    const r = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [
        verified({
          title: 'Arrears trending up',
          description: 'overdue count has doubled.',
        }),
      ],
      routingRules: NULL_PORT,
    });
    expect(r.actions[0]!.targetModule).toBe('FINANCE');
    expect(r.actions[0]!.action).toBe('open_arrears_follow_up');
  });

  it('matches rent-review opportunity to FINANCE.evaluate_rent_review_opportunity', async () => {
    const r = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [
        verified({
          kind: 'opportunity',
          title: 'Rent review opportunity',
          description: 'comparables suggest above-market price.',
        }),
      ],
      routingRules: NULL_PORT,
    });
    expect(r.actions[0]!.targetModule).toBe('FINANCE');
    expect(r.actions[0]!.action).toBe('evaluate_rent_review_opportunity');
  });

  it('matches collection gap to FINANCE.review_collection_performance', async () => {
    const r = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [
        verified({
          kind: 'gap',
          title: 'Rent collection below target',
          description: 'collection rate dropped 12%.',
        }),
      ],
      routingRules: NULL_PORT,
    });
    expect(r.actions[0]!.targetModule).toBe('FINANCE');
  });

  it('drops hypotheses that match no rule', async () => {
    const r = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [
        verified({
          kind: 'gap',
          title: 'Some random unmatched gap',
          description: 'no keywords match.',
        }),
      ],
      routingRules: NULL_PORT,
    });
    expect(r.actions).toHaveLength(0);
  });

  it('flags requiresApproval based on severity', async () => {
    const high = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [verified({ severity: 'CRITICAL' })],
      routingRules: NULL_PORT,
    });
    expect(high.actions[0]!.requiresApproval).toBe(true);
  });

  it('returns a sourceMap with matching hypothesis indices', async () => {
    const r = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [verified()],
      routingRules: NULL_PORT,
    });
    expect(r.sourceMap[0]!.hypothesisIndex).toBe(0);
  });

  it('tolerates routing port failure', async () => {
    const r = await emitRecommendedActions({
      tenantId: 't',
      hypotheses: [verified()],
      routingRules: {
        async lookup() {
          throw new Error('routing down');
        },
      },
    });
    // Falls back to built-in matrix.
    expect(r.actions[0]!.targetModule).toBe('ESTATE');
  });
});
