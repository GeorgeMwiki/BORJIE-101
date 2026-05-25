import { describe, expect, it } from 'vitest';
import { createAgenticOS } from '../index.js';
import {
  makeAgentSummary,
  makeCapabilityRegistry,
  makeEnvelope,
  makeFakeAgentRegistry,
  makeFakeBrain,
  makeFakeConstitution,
  makeFakeKG,
  makeFakeMCP,
  makeFakeObservationStore,
  makeFakeOpenClaw,
  makeFakeOrchestrator,
  makeFakeTrustStore,
  makeFakeWorkflowEngine,
} from './test-helpers.js';
import type { AutonomyLevel, CapabilityDeclaration, TrustScore } from '../types.js';

const cap: CapabilityDeclaration = Object.freeze({
  id: 'lease.renew',
  name: 'Renew',
  description: 'd',
  inputs: { type: 'object', required: ['leaseId'] },
  outputs: { type: 'object' },
  sideEffects: 'med',
  costEstimateUsdCents: 50,
  latencyEstimateMs: 1500,
  requiredScope: ['lease:write'],
  jurisdictions: ['TZ', 'KE'],
  version: '1.0.0',
});

describe('composition-factory / createAgenticOS', () => {
  it('accepts ports for every in-flight package primitive', () => {
    const os = createAgenticOS({
      brain: makeFakeBrain(),
      orchestrator: makeFakeOrchestrator(),
      agentRegistry: makeFakeAgentRegistry([]),
      capabilityRegistry: makeCapabilityRegistry(),
      constitution: makeFakeConstitution(),
      kg: makeFakeKG(),
      observations: makeFakeObservationStore(),
      trustStore: makeFakeTrustStore([]),
      workflowEngine: makeFakeWorkflowEngine(),
      mcp: makeFakeMCP(['lease.renew', 'maintenance.fix']),
      openClawModel: makeFakeOpenClaw(),
    });
    expect(os.brain).toBeDefined();
    expect(os.orchestrator).toBeDefined();
    expect(os.agentRegistry).toBeDefined();
    expect(os.capabilityRegistry).toBeDefined();
    expect(os.constitution).toBeDefined();
    expect(os.kg).toBeDefined();
    expect(os.observations).toBeDefined();
    expect(os.trustStore).toBeDefined();
    expect(os.workflowEngine).toBeDefined();
    expect(os.mcp).toBeDefined();
    expect(os.openClawModel).toBeDefined();
  });

  it('creates default capability registry, observations, trust store when omitted', () => {
    const os = createAgenticOS({
      brain: makeFakeBrain(),
      orchestrator: makeFakeOrchestrator(),
      agentRegistry: makeFakeAgentRegistry([]),
      constitution: makeFakeConstitution(),
      kg: makeFakeKG(),
    });
    expect(os.capabilityRegistry).toBeDefined();
    expect(os.observations).toBeDefined();
    expect(os.trustStore).toBeDefined();
  });

  it('routes a request end-to-end via handleRequest', async () => {
    const caps = makeCapabilityRegistry();
    await caps.register({ agentId: 'agent-a', capability: cap });

    const initialTrust: ReadonlyArray<TrustScore> = [
      {
        agentId: 'agent-a',
        capabilityId: 'lease.renew',
        meanSuccessRate: 0.9,
        sampleSize: 50,
        recentSuccessRate: 0.92,
        lastUpdatedAt: '2026-05-23T00:00:00Z',
        recommendedCeiling: 'L4',
      },
    ];

    const os = createAgenticOS({
      brain: makeFakeBrain(),
      orchestrator: makeFakeOrchestrator({ outcome: 'success' }),
      agentRegistry: makeFakeAgentRegistry([
        makeAgentSummary({ agentId: 'agent-a', domains: ['lease'] }),
      ]),
      capabilityRegistry: caps,
      constitution: makeFakeConstitution(),
      kg: makeFakeKG(),
      trustStore: makeFakeTrustStore(initialTrust),
      openClawModel: makeFakeOpenClaw(
        new Map<string, AutonomyLevel>([['TZ::med', 'L4']]),
      ),
    });

    const result = await os.handleRequest(
      makeEnvelope({ utterance: 'please renew my lease' }),
    );
    expect(result.routingDecision.chosenAgent?.agentId).toBe('agent-a');
    expect(result.goal).not.toBeNull();
    expect(result.subGoals.length).toBeGreaterThan(0);
    expect(result.goalResult).not.toBeNull();
    expect(result.goalResult?.outcome).toBe('success');
  });

  it('returns null goal when no agent can be routed', async () => {
    const os = createAgenticOS({
      brain: makeFakeBrain(),
      orchestrator: makeFakeOrchestrator(),
      agentRegistry: makeFakeAgentRegistry([]),
      capabilityRegistry: makeCapabilityRegistry(), // empty
      constitution: makeFakeConstitution(),
      kg: makeFakeKG(),
    });
    const result = await os.handleRequest(makeEnvelope());
    expect(result.routingDecision.chosenAgent).toBeNull();
    expect(result.goal).toBeNull();
    expect(result.subGoals).toEqual([]);
    expect(result.goalResult).toBeNull();
    expect(result.reason).toBeDefined();
  });

  it('exposes route() for lower-level callers', async () => {
    const caps = makeCapabilityRegistry();
    await caps.register({ agentId: 'agent-a', capability: cap });

    const os = createAgenticOS({
      brain: makeFakeBrain(),
      orchestrator: makeFakeOrchestrator(),
      agentRegistry: makeFakeAgentRegistry([
        makeAgentSummary({ agentId: 'agent-a', domains: ['lease'] }),
      ]),
      capabilityRegistry: caps,
      constitution: makeFakeConstitution(),
      kg: makeFakeKG(),
    });

    const decision = await os.route(makeEnvelope());
    expect(decision.chosenAgent?.agentId).toBe('agent-a');
  });

  it('passes brainTimeoutMs through to the gateway', async () => {
    const caps = makeCapabilityRegistry();
    const os = createAgenticOS({
      brain: makeFakeBrain({ throwOn: 'classify' }),
      orchestrator: makeFakeOrchestrator(),
      agentRegistry: makeFakeAgentRegistry([]),
      capabilityRegistry: caps,
      constitution: makeFakeConstitution(),
      kg: makeFakeKG(),
      brainTimeoutMs: 50,
    });
    const decision = await os.route(makeEnvelope());
    expect(decision.fallbackUsed).toBe(true);
  });
});
