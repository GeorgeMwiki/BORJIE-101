/**
 * Grounding-facts provider, DP cohort source adapter, and Anthropic
 * judge — adapter-level tests with stub backends.
 */

import { describe, it, expect } from 'vitest';
import {
  composeSovereign,
  createDpCohortSource,
  createAnthropicJudge,
  type DpAggregator,
  type DpAggregateOutcome,
  type GroundingFactsProvider,
  type GroundingFact,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type AnthropicMessagesClient,
  type ScopeContext,
} from '../kernel/index.js';

const SCOPE: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_hq',
  roles: ['platform-admin'],
  personaId: 'sovereign-admin',
};

function stubSensor(text: string): Sensor {
  return {
    id: 'stub',
    modelId: 'stub-1',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(_a: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'stub-1',
        sensorId: 'stub',
      };
    },
  };
}

describe('groundingFactsProvider', () => {
  it('mixes facts into the system prompt the sensor sees', async () => {
    let receivedSystem = '';
    const captureSensor: Sensor = {
      id: 'capture',
      modelId: 'capture-1',
      priority: 1,
      capabilities: ['fast'],
      async call(args) {
        receivedSystem = args.system;
        return {
          text: 'ack',
          thought: null,
          toolCalls: [],
          latencyMs: 1,
          modelId: 'capture-1',
          sensorId: 'capture',
        };
      },
    };
    const fact: GroundingFact = {
      id: 'gf_1',
      label: 'On-time collection',
      value: 0.93,
      unit: 'pct',
      source: 'ledger',
      asOf: '2026-05-01T00:00:00Z',
    };
    const grounding: GroundingFactsProvider = {
      async fetch() {
        return [fact];
      },
    };
    const sov = composeSovereign({
      extraSensors: [captureSensor],
      groundingFacts: grounding,
    });
    await sov.kernel.think({
      threadId: 't',
      userMessage: 'How is collection going?',
      scope: SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'platform-hq',
    });
    expect(receivedSystem).toContain('Grounding facts');
    expect(receivedSystem).toContain('[gf_1]');
    expect(receivedSystem).toContain('On-time collection');
    expect(receivedSystem).toContain('93.0%');
  });

  it('handles a failing provider gracefully (kernel still answers)', async () => {
    const failing: GroundingFactsProvider = {
      async fetch() {
        throw new Error('upstream down');
      },
    };
    const sov = composeSovereign({
      extraSensors: [stubSensor('fallback ok')],
      groundingFacts: failing,
    });
    const decision = await sov.kernel.think({
      threadId: 't',
      userMessage: 'all good?',
      scope: SCOPE,
      tier: 'industry',
      stakes: 'low',
      surface: 'platform-hq',
    });
    expect(decision.kind === 'answer' || decision.kind === 'softened').toBe(true);
  });
});

describe('DP cohort source adapter', () => {
  it('routes the right keyword to the right statistic and emits a CohortFinding', async () => {
    const queries: Array<{ statistic: string }> = [];
    const aggregator: DpAggregator = {
      async aggregate(query, _ctx): Promise<DpAggregateOutcome> {
        queries.push({ statistic: query.statistic });
        return {
          kind: 'published',
          statistic: query.statistic,
          noisedValue: 0.92,
          contributingTenants: 12,
          generatedAt: '2026-05-05T00:00:00Z',
        };
      },
    };
    const source = createDpCohortSource({
      aggregator,
      authContext: { actorUserId: 'u', actorRoles: ['platform-admin'] },
    });
    const findings = await source.findRelevant({
      userMessage: 'show me on-time rent collected',
      tier: 'industry',
      limit: 4,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]?.statistic).toContain('collection');
    expect(queries[0]?.statistic).toBe('collection_rate');
  });

  it('returns empty when no keywords match', async () => {
    const aggregator: DpAggregator = {
      async aggregate() {
        return { kind: 'published', noisedValue: 0 } as DpAggregateOutcome;
      },
    };
    const source = createDpCohortSource({
      aggregator,
      authContext: { actorUserId: 'u', actorRoles: [] },
    });
    const findings = await source.findRelevant({
      userMessage: 'tell me a joke',
      tier: 'industry',
      limit: 4,
    });
    expect(findings).toHaveLength(0);
  });

  it('skips refused aggregator results', async () => {
    const aggregator: DpAggregator = {
      async aggregate() {
        return { kind: 'refused', reason: 'k_anonymity_not_met' } as DpAggregateOutcome;
      },
    };
    const source = createDpCohortSource({
      aggregator,
      authContext: { actorUserId: 'u', actorRoles: [] },
    });
    const findings = await source.findRelevant({
      userMessage: 'arrears across the network',
      tier: 'industry',
      limit: 4,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('Anthropic Haiku judge', () => {
  it('parses a JSON score from the model response', async () => {
    const stubClient: AnthropicMessagesClient = {
      messages: {
        async create() {
          return {
            id: 'm_1',
            model: 'claude-haiku-4-5-20251001',
            stop_reason: 'end_turn',
            content: [
              {
                type: 'text',
                text: '{"score": 0.78, "reasons": ["mostly grounded"]}',
              },
            ],
          };
        },
      },
    };
    const judge = createAnthropicJudge(stubClient);
    const out = await judge('Some draft answer.');
    expect(out.score).toBeCloseTo(0.78, 5);
  });

  it('returns 1.0 (neutral) on a malformed model response', async () => {
    const stubClient: AnthropicMessagesClient = {
      messages: {
        async create() {
          return {
            id: 'm_2',
            model: 'haiku',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: 'not even json here' }],
          };
        },
      },
    };
    const judge = createAnthropicJudge(stubClient);
    const out = await judge('Some draft.');
    expect(out.score).toBe(1);
  });

  it('returns 1.0 when the client throws (fail-open)', async () => {
    const stubClient: AnthropicMessagesClient = {
      messages: {
        async create() {
          throw new Error('rate limit');
        },
      },
    };
    const judge = createAnthropicJudge(stubClient);
    const out = await judge('Some draft.');
    expect(out.score).toBe(1);
  });
});
