import { describe, expect, it } from 'vitest';
import { routeRequest } from '../brain-first-gateway/index.js';
import {
  makeCapabilityRegistry,
  makeEnvelope,
  makeFakeAgentRegistry,
  makeFakeBrain,
  makeFakeOpenClaw,
  makeFakeTrustStore,
  makeAgentSummary,
} from './test-helpers.js';
import type { CapabilityDeclaration, IntentClassification, TrustScore } from '../types.js';
import { TenantScopeError } from '../types.js';

const baseCapability: CapabilityDeclaration = Object.freeze({
  id: 'lease.renew',
  name: 'Renew lease',
  description: 'Renews tenant lease',
  inputs: { type: 'object', required: ['leaseId'] },
  outputs: { type: 'object' },
  sideEffects: 'med',
  costEstimateUsdCents: 50,
  latencyEstimateMs: 1500,
  requiredScope: ['tenant:lease:write'],
  jurisdictions: ['TZ', 'KE'],
  version: '1.0.0',
});

describe('brain-first-gateway / routeRequest', () => {
  it('routes by intent → capability → best-trust agent', async () => {
    const caps = makeCapabilityRegistry();
    await caps.register({ agentId: 'agent-a', capability: baseCapability });
    await caps.register({ agentId: 'agent-b', capability: baseCapability });

    const agentRegistry = makeFakeAgentRegistry([
      makeAgentSummary({ agentId: 'agent-a', domains: ['lease'] }),
      makeAgentSummary({ agentId: 'agent-b', domains: ['lease'] }),
    ]);

    const initialTrust: ReadonlyArray<TrustScore> = [
      {
        agentId: 'agent-a',
        capabilityId: 'lease.renew',
        meanSuccessRate: 0.9,
        sampleSize: 100,
        recentSuccessRate: 0.95,
        lastUpdatedAt: '2026-05-23T00:00:00Z',
        recommendedCeiling: 'L4',
      },
      {
        agentId: 'agent-b',
        capabilityId: 'lease.renew',
        meanSuccessRate: 0.4,
        sampleSize: 100,
        recentSuccessRate: 0.4,
        lastUpdatedAt: '2026-05-23T00:00:00Z',
        recommendedCeiling: 'L1',
      },
    ];

    const decision = await routeRequest({
      envelope: makeEnvelope({ jurisdiction: 'TZ' }),
      brain: makeFakeBrain(),
      agentRegistry,
      capabilities: caps,
      trustStore: makeFakeTrustStore(initialTrust),
    });

    expect(decision.chosenAgent).not.toBeNull();
    expect(decision.chosenAgent?.agentId).toBe('agent-a');
    expect(decision.fallbackUsed).toBe(false);
  });

  it('falls back to deterministic intent when brain throws', async () => {
    const caps = makeCapabilityRegistry();
    await caps.register({ agentId: 'agent-a', capability: baseCapability });

    const decision = await routeRequest({
      envelope: makeEnvelope({ utterance: 'I need lease renewal' }),
      brain: makeFakeBrain({ throwOn: 'classify' }),
      agentRegistry: makeFakeAgentRegistry([
        makeAgentSummary({ agentId: 'agent-a', domains: ['lease'] }),
      ]),
      capabilities: caps,
      trustStore: makeFakeTrustStore([]),
      fallbackRoutes: [
        {
          intentPrefix: 'lease',
          capabilityId: 'lease.renew',
          riskClass: 'med',
        },
      ],
    });

    expect(decision.fallbackUsed).toBe(false); // matched intent prefix
    expect(decision.chosenAgent?.agentId).toBe('agent-a');
    expect(decision.intent.primary).toBe('lease');
  });

  it('uses pure fallback intent when brain throws AND no prefix matches', async () => {
    const caps = makeCapabilityRegistry();

    const decision = await routeRequest({
      envelope: makeEnvelope({ utterance: 'something totally novel' }),
      brain: makeFakeBrain({ throwOn: 'classify' }),
      agentRegistry: makeFakeAgentRegistry([]),
      capabilities: caps,
      trustStore: makeFakeTrustStore([]),
      fallbackRoutes: [],
    });

    expect(decision.fallbackUsed).toBe(true);
    expect(decision.chosenAgent).toBeNull();
    expect(decision.intent.primary).toBe('unclassified.fallback');
  });

  it('falls back when brain exceeds timeout', async () => {
    const caps = makeCapabilityRegistry();
    const slowBrain = {
      ...makeFakeBrain(),
      async classifyIntent() {
        await new Promise((r) => setTimeout(r, 200));
        return Object.freeze<IntentClassification>({
          primary: 'lease.renew',
          secondary: [],
          confidence: 0.9,
          rationale: 'late',
          suggestedDomain: 'lease',
          riskClass: 'med',
          entities: {},
        });
      },
    };

    const decision = await routeRequest({
      envelope: makeEnvelope({ utterance: 'lease renewal' }),
      brain: slowBrain,
      agentRegistry: makeFakeAgentRegistry([]),
      capabilities: caps,
      trustStore: makeFakeTrustStore([]),
      brainTimeoutMs: 50,
      fallbackRoutes: [
        {
          intentPrefix: 'lease',
          capabilityId: 'lease.renew',
          riskClass: 'med',
        },
      ],
    });

    expect(decision.intent.rationale).toContain('deterministic');
  });

  it('throws when envelope missing tenantId', async () => {
    const caps = makeCapabilityRegistry();
    await expect(
      routeRequest({
        envelope: makeEnvelope({ tenantId: '' }),
        brain: makeFakeBrain(),
        agentRegistry: makeFakeAgentRegistry([]),
        capabilities: caps,
        trustStore: makeFakeTrustStore([]),
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });

  it('returns null chosen agent when no capability matches', async () => {
    const caps = makeCapabilityRegistry();
    const decision = await routeRequest({
      envelope: makeEnvelope(),
      brain: makeFakeBrain({
        intent: Object.freeze<IntentClassification>({
          primary: 'unknown.thing',
          secondary: [],
          confidence: 0.9,
          rationale: 'unknown',
          suggestedDomain: 'unknown',
          riskClass: 'low',
          entities: {},
        }),
      }),
      agentRegistry: makeFakeAgentRegistry([]),
      capabilities: caps,
      trustStore: makeFakeTrustStore([]),
    });
    expect(decision.chosenAgent).toBeNull();
    expect(decision.rationale).toContain('no capability matched');
  });

  it('respects autonomy ceiling from OpenClaw port', async () => {
    const caps = makeCapabilityRegistry();
    await caps.register({
      agentId: 'agent-a',
      capability: { ...baseCapability, sideEffects: 'critical' },
    });

    const openClaw = makeFakeOpenClaw(
      new Map([['TZ::high', 'L1' as const]]),
    );

    const decision = await routeRequest({
      envelope: makeEnvelope({ jurisdiction: 'TZ' }),
      brain: makeFakeBrain({
        intent: Object.freeze<IntentClassification>({
          primary: 'lease.renew',
          secondary: [],
          confidence: 0.9,
          rationale: 'r',
          suggestedDomain: 'lease',
          riskClass: 'high',
          entities: {},
        }),
      }),
      agentRegistry: makeFakeAgentRegistry([
        makeAgentSummary({ agentId: 'agent-a', domains: ['lease'] }),
      ]),
      capabilities: caps,
      trustStore: makeFakeTrustStore([]),
      openClaw,
    });

    expect(decision.chosenAgent).not.toBeNull();
    // chosen because L1 ceiling still allows match; agent autonomy headroom is small
    expect(decision.chosenAgent?.breakdown.autonomyHeadroom).toBeLessThanOrEqual(1);
  });
});
