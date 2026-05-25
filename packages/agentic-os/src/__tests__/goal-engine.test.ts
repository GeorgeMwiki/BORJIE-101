import { describe, expect, it } from 'vitest';
import {
  composeGoal,
  decomposeIntoSubgoals,
  executeGoal,
  parseIntent,
} from '../goal-engine/index.js';
import {
  makeAgentMatch,
  makeCapabilityRegistry,
  makeEnvelope,
  makeFakeBrain,
  makeFakeObservationStore,
  makeFakeOrchestrator,
} from './test-helpers.js';
import { GoalDecompositionError } from '../types.js';
import type { Goal, SubGoal } from '../types.js';

describe('goal-engine / parseIntent', () => {
  it('asks the brain to classify and returns the intent', async () => {
    const intent = await parseIntent({
      envelope: makeEnvelope({ utterance: 'fix my plumbing' }),
      brain: makeFakeBrain(),
    });
    expect(intent.primary).toBe('lease.renew');
    expect(intent.confidence).toBeGreaterThan(0);
  });
});

describe('goal-engine / composeGoal', () => {
  it('returns a goal scoped to the tenant', async () => {
    const envelope = makeEnvelope({ tenantId: 't-9' });
    const intent = await parseIntent({ envelope, brain: makeFakeBrain() });
    const goal = await composeGoal({ envelope, intent, brain: makeFakeBrain() });
    expect(goal.tenantId).toBe('t-9');
    expect(goal.intent).toEqual(intent);
    expect(goal.successCriteria.length).toBeGreaterThan(0);
  });
});

describe('goal-engine / decomposeIntoSubgoals', () => {
  it('throws when no candidates supplied', async () => {
    const envelope = makeEnvelope();
    const intent = await parseIntent({ envelope, brain: makeFakeBrain() });
    const goal = await composeGoal({ envelope, intent, brain: makeFakeBrain() });
    await expect(
      decomposeIntoSubgoals({
        goal,
        brain: makeFakeBrain(),
        capabilities: makeCapabilityRegistry(),
        candidates: [],
      }),
    ).rejects.toBeInstanceOf(GoalDecompositionError);
  });

  it('produces subgoals assigned to known agents', async () => {
    const envelope = makeEnvelope();
    const intent = await parseIntent({ envelope, brain: makeFakeBrain() });
    const goal = await composeGoal({ envelope, intent, brain: makeFakeBrain() });
    const candidates = [makeAgentMatch({ agentId: 'agent-x' })];
    const subGoals = await decomposeIntoSubgoals({
      goal,
      brain: makeFakeBrain(),
      capabilities: makeCapabilityRegistry(),
      candidates,
    });
    expect(subGoals.length).toBeGreaterThan(0);
    for (const sg of subGoals) {
      expect(sg.assignedAgentId).toBe('agent-x');
    }
  });

  it('rejects subgoals assigned to unknown agents', async () => {
    const envelope = makeEnvelope();
    const intent = await parseIntent({ envelope, brain: makeFakeBrain() });
    const goal = await composeGoal({ envelope, intent, brain: makeFakeBrain() });
    const candidates = [makeAgentMatch({ agentId: 'agent-x' })];
    const badBrain = makeFakeBrain({
      subGoals: [
        {
          id: 'sg-bad',
          parentGoalId: goal.id,
          description: 'bad',
          assignedAgentId: 'agent-rogue',
          capabilityId: 'lease.renew',
          dependsOn: [],
          inputs: {},
          createdAt: '2026-05-24T00:00:00Z',
        },
      ],
    });
    await expect(
      decomposeIntoSubgoals({
        goal,
        brain: badBrain,
        capabilities: makeCapabilityRegistry(),
        candidates,
      }),
    ).rejects.toBeInstanceOf(GoalDecompositionError);
  });
});

describe('goal-engine / executeGoal', () => {
  function buildGoalFixture(): { goal: Goal; subGoals: SubGoal[] } {
    const goal: Goal = Object.freeze({
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
      successCriteria: [
        { id: 'crit-1', check: 'lease.active', weight: 1 },
      ],
      scope: {},
      createdAt: '2026-05-24T00:00:00Z',
    });
    const subGoals: SubGoal[] = [
      {
        id: 'sg-1',
        parentGoalId: 'g-1',
        description: 'step 1',
        assignedAgentId: 'agent-a',
        capabilityId: 'lease.renew',
        dependsOn: [],
        inputs: {},
        createdAt: '2026-05-24T00:00:00Z',
      },
      {
        id: 'sg-2',
        parentGoalId: 'g-1',
        description: 'step 2',
        assignedAgentId: 'agent-b',
        capabilityId: 'lease.renew.confirm',
        dependsOn: ['sg-1'],
        inputs: {},
        createdAt: '2026-05-24T00:00:00Z',
      },
    ];
    return { goal, subGoals };
  }

  it('executes subgoals in topological waves and rolls up success', async () => {
    const { goal, subGoals } = buildGoalFixture();
    const result = await executeGoal({
      goal,
      subGoals,
      orchestrator: makeFakeOrchestrator({ outcome: 'success' }),
    });
    expect(result.outcome).toBe('success');
    expect(result.subGoalResults.length).toBe(2);
    expect(result.successCriteriaMet).toEqual(['crit-1']);
    expect(result.successCriteriaMissed).toEqual([]);
  });

  it('rolls up failure when any subgoal fails', async () => {
    const { goal, subGoals } = buildGoalFixture();
    const result = await executeGoal({
      goal,
      subGoals,
      orchestrator: makeFakeOrchestrator({
        perAgentOutcomes: new Map([['agent-b', 'failure']]),
      }),
    });
    expect(result.outcome).toBe('failure');
    expect(result.successCriteriaMissed.length).toBeGreaterThan(0);
  });

  it('rolls up escalated when any subgoal escalates', async () => {
    const { goal, subGoals } = buildGoalFixture();
    const result = await executeGoal({
      goal,
      subGoals,
      orchestrator: makeFakeOrchestrator({
        perAgentOutcomes: new Map([['agent-a', 'escalated']]),
      }),
    });
    expect(result.outcome).toBe('escalated');
  });

  it('emits observations into the store at each step', async () => {
    const { goal, subGoals } = buildGoalFixture();
    const store = makeFakeObservationStore();
    await executeGoal({
      goal,
      subGoals,
      orchestrator: makeFakeOrchestrator({ outcome: 'success' }),
      observations: store,
    });
    const kinds = store.observations.map((o) => o.kind);
    expect(kinds).toContain('subgoal-assigned');
    expect(kinds).toContain('capability-result');
    expect(kinds).toContain('goal-completed');
  });

  it('detects subgoal cycles', async () => {
    const goal: Goal = {
      id: 'g-2',
      requestId: 'r-2',
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
      headline: 'cycle',
      successCriteria: [{ id: 'c', check: 'x', weight: 1 }],
      scope: {},
      createdAt: '2026-05-24T00:00:00Z',
    };
    const subGoals: SubGoal[] = [
      {
        id: 'a',
        parentGoalId: 'g-2',
        description: 'a',
        assignedAgentId: 'agent-x',
        capabilityId: 'c',
        dependsOn: ['b'],
        inputs: {},
        createdAt: '2026-05-24T00:00:00Z',
      },
      {
        id: 'b',
        parentGoalId: 'g-2',
        description: 'b',
        assignedAgentId: 'agent-x',
        capabilityId: 'c',
        dependsOn: ['a'],
        inputs: {},
        createdAt: '2026-05-24T00:00:00Z',
      },
    ];
    await expect(
      executeGoal({
        goal,
        subGoals,
        orchestrator: makeFakeOrchestrator(),
      }),
    ).rejects.toBeInstanceOf(GoalDecompositionError);
  });
});
