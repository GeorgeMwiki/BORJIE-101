/**
 * Tests for the kernel's step-4 agency mix-in.
 *
 *   1. When agency is wired and the user has active goals, the system
 *      prompt contains "What you've asked me to work on:" + each
 *      goal's title.
 *   2. Without an agency port wired, the kernel still answers normally
 *      (the side-channel never breaks the turn).
 */
import { describe, it, expect } from 'vitest';
import {
  composeSovereign,
  type ScopeContext,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
} from '../kernel/index.js';
import { createInMemoryGoalsPort } from '../kernel/agency/goals/goal-tracker.js';
import { decomposePlan } from '../kernel/agency/goals/plan-decomposer.js';

const SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function captureSensor(): { sensor: Sensor; systems: string[] } {
  const systems: string[] = [];
  const sensor: Sensor = {
    id: 'capture',
    modelId: 'capture-1',
    priority: 1,
    capabilities: ['fast'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      systems.push(args.system);
      return {
        text: 'ack',
        thought: null,
        toolCalls: [],
        latencyMs: 0,
        modelId: 'capture-1',
        sensorId: 'capture',
      };
    },
  };
  return { sensor, systems };
}

describe('kernel-agency mix-in (step 4)', () => {
  it('mixes ACTIVE goals into the system prompt', async () => {
    const goals = createInMemoryGoalsPort();
    await goals.open({
      tenantId: 't_demo',
      userId: 'u_alice',
      threadId: 'th_1',
      title: 'Resolve arrears for unit 4B',
      description: '',
      status: 'active',
      priority: 'high',
      steps: [
        { seq: 0, description: 'remind', toolName: null, toolPayload: null },
        { seq: 1, description: 'escalate', toolName: null, toolPayload: null },
      ],
    });
    await goals.open({
      tenantId: 't_demo',
      userId: 'u_alice',
      threadId: 'th_2',
      title: 'Renew lease L-417',
      description: '',
      status: 'completed', // shouldn't appear
      priority: 'medium',
      steps: [],
    });

    const { sensor, systems } = captureSensor();
    const sov = composeSovereign({
      extraSensors: [sensor],
      agency: {
        goals,
        executor: {
          async executeGoal() {
            return {
              goalId: '',
              stepsRun: 0,
              stepsSucceeded: 0,
              stepsFailed: 0,
              stepsAwaitingApproval: 0,
              proposedActionIds: [],
              failureMessages: [],
            };
          },
        },
        planDecomposer: decomposePlan,
      },
    });
    await sov.kernel.think({
      threadId: 'th_x',
      userMessage: 'good morning',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });
    expect(systems).toHaveLength(1);
    expect(systems[0]).toContain("What you've asked me to work on:");
    expect(systems[0]).toContain('Resolve arrears for unit 4B');
    expect(systems[0]).not.toContain('Renew lease L-417');
  });

  it('missing agency port does not break the turn', async () => {
    const { sensor, systems } = captureSensor();
    const sov = composeSovereign({ extraSensors: [sensor] });
    const decision = await sov.kernel.think({
      threadId: 'th_x',
      userMessage: 'good morning',
      scope: SCOPE,
      tier: 'tenant',
      stakes: 'low',
      surface: 'estate-manager-app',
    });
    expect(decision.kind).toBe('answer');
    expect(systems).toHaveLength(1);
    expect(systems[0]).not.toContain("What you've asked me to work on:");
  });
});
