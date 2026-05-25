import { describe, expect, it } from 'vitest';
import {
  enrichContextFromKG,
  propagateConsequences,
  recordAgentAction,
} from '../living-kg/index.js';
import { makeFakeKG } from './test-helpers.js';
import type { Goal, LivingKGUpdate } from '../types.js';

describe('living-kg / recordAgentAction', () => {
  it('translates action into KG triples and writes them', async () => {
    const kg = makeFakeKG();
    const update = await recordAgentAction({
      action: {
        id: 'a-1',
        agentId: 'agent-a',
        tenantId: 't-1',
        actionType: 'lease.renew',
        subjectId: 'lease-100',
        objectId: 'period-2026',
      },
      kg,
    });
    expect(update.deltas.length).toBeGreaterThan(0);
    expect(kg.deltas.length).toBeGreaterThan(0);
    expect(kg.deltas[0]?.subjectId).toBe('lease-100');
    expect(kg.deltas[0]?.predicate).toBe('lease.renew');
  });

  it('falls back to a trace triple when no objectId or extra deltas', async () => {
    const kg = makeFakeKG();
    const update = await recordAgentAction({
      action: {
        id: 'a-2',
        agentId: 'agent-a',
        tenantId: 't-1',
        actionType: 'inspection',
        subjectId: 'unit-7',
      },
      kg,
    });
    expect(update.deltas.length).toBe(1);
    expect(update.deltas[0]?.predicate).toBe('wasActedOnBy');
    expect(update.deltas[0]?.objectId).toBe('agent-a');
  });

  it('writes extraDeltas alongside the primary triple', async () => {
    const kg = makeFakeKG();
    await recordAgentAction({
      action: {
        id: 'a-3',
        agentId: 'agent-a',
        tenantId: 't-1',
        actionType: 'payment.received',
        subjectId: 'lease-7',
        objectId: 'payment-100',
        extraDeltas: [
          {
            subjectId: 'lease-7',
            predicate: 'hasPaymentRecord',
            objectId: 'rec-100',
            op: 'add',
          },
        ],
      },
      kg,
    });
    expect(kg.deltas.length).toBe(2);
  });
});

describe('living-kg / enrichContextFromKG', () => {
  function makeGoal(scope: Record<string, unknown>): Goal {
    return {
      id: 'g-1',
      requestId: 'r-1',
      tenantId: 't-1',
      intent: {
        primary: 'lease.renew',
        secondary: [],
        confidence: 0.9,
        rationale: 'r',
        suggestedDomain: 'lease',
        riskClass: 'med',
        entities: {},
      },
      headline: 'Renew lease',
      successCriteria: [],
      scope,
      createdAt: '2026-05-24T00:00:00Z',
    };
  }

  it('fetches a subgraph relevant to the goal', async () => {
    const kg = makeFakeKG();
    kg.setSubgraph([
      { subjectId: 'lease-100', predicate: 'lease.renew', objectId: 'period-2026' },
      { subjectId: 'lease-100', predicate: 'occupiedBy', objectId: 'tenant-7' },
    ]);
    const ctx = await enrichContextFromKG({
      goal: makeGoal({ leaseId: 'lease-100' }),
      kg,
    });
    expect(ctx.fragments.length).toBe(2);
    expect(ctx.approxTokens).toBeGreaterThan(0);
  });

  it('returns empty when goal has no extractable subjectIds', async () => {
    const kg = makeFakeKG();
    const ctx = await enrichContextFromKG({
      goal: makeGoal({}),
      kg,
    });
    expect(ctx.fragments.length).toBe(0);
  });

  it('sorts fragments by relevance score desc', async () => {
    const kg = makeFakeKG();
    kg.setSubgraph([
      { subjectId: 'lease-100', predicate: 'occupiedBy', objectId: 'tenant-7' },
      { subjectId: 'lease-100', predicate: 'lease.renew', objectId: 'period-2026' },
    ]);
    const ctx = await enrichContextFromKG({
      goal: makeGoal({ leaseId: 'lease-100' }),
      kg,
    });
    expect(ctx.fragments[0]?.score).toBeGreaterThanOrEqual(
      ctx.fragments[1]?.score ?? 0,
    );
  });
});

describe('living-kg / propagateConsequences', () => {
  it('derives downstream facts from matching rules', async () => {
    const kg = makeFakeKG();
    const primary: LivingKGUpdate = {
      id: 'kg-1',
      tenantId: 't-1',
      triggeredByAgentId: 'agent-a',
      triggeredByActionId: 'a-1',
      deltas: [
        {
          subjectId: 'lease-100',
          predicate: 'paymentReceived',
          objectId: 'pay-1',
          op: 'add',
        },
      ],
      propagatedDeltas: [],
      recordedAt: '2026-05-24T00:00:00Z',
    };
    const out = await propagateConsequences({
      update: primary,
      rules: [
        {
          whenPredicate: 'paymentReceived',
          addPredicate: 'arrearsReducedBy',
        },
      ],
      kg,
    });
    expect(out.propagatedDeltas.length).toBe(1);
    expect(out.propagatedDeltas[0]?.predicate).toBe('arrearsReducedBy');
    expect(kg.deltas.length).toBe(1);
  });

  it('emits no propagated deltas when no rules match', async () => {
    const kg = makeFakeKG();
    const primary: LivingKGUpdate = {
      id: 'kg-2',
      tenantId: 't-1',
      triggeredByAgentId: 'agent-a',
      triggeredByActionId: 'a-2',
      deltas: [
        {
          subjectId: 's',
          predicate: 'unrelated',
          objectId: 'o',
          op: 'add',
        },
      ],
      propagatedDeltas: [],
      recordedAt: '2026-05-24T00:00:00Z',
    };
    const out = await propagateConsequences({
      update: primary,
      rules: [{ whenPredicate: 'something-else', addPredicate: 'x' }],
      kg,
    });
    expect(out.propagatedDeltas.length).toBe(0);
    expect(kg.deltas.length).toBe(0);
  });
});
