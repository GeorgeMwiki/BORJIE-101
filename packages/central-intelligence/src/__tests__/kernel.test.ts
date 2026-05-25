/**
 * Brain kernel — composition test.
 *
 * Drives the REAL kernel through every step of the 13-step pipeline
 * with a deterministic-scripted Sensor (no mocks beyond the injected
 * ports). Verifies:
 *   - cache hit on repeat
 *   - inviolable refusal on bulk-PII export
 *   - tier compatibility refusal (platform scope + tenant tier)
 *   - sensor failover to secondary on primary failure
 *   - persona drift recording
 *   - policy gate redaction of PII
 *   - confidence vector populated
 *   - CoT reservoir captured for critical stakes
 */

import { describe, it, expect } from 'vitest';
import {
  createBrainKernel,
  createBrainCache,
  createCotReservoir,
  createInMemoryCotReservoirSink,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtRequest,
  type PersonaDriftEvent,
  type PersonaDriftSink,
} from '../kernel/index.js';
import type { ScopeContext } from '../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_demo',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

const PLATFORM_SCOPE: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_hq',
  roles: ['platform-admin'],
  personaId: 'platform-sovereign',
};

function scriptedSensor(
  id: string,
  result: Partial<SensorCallResult> & Pick<SensorCallResult, 'text'>,
  opts: { fail?: boolean; priority?: number } = {},
): Sensor {
  return {
    id,
    modelId: result.modelId ?? `${id}-model`,
    priority: opts.priority ?? 10,
    capabilities: ['thinking', 'fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      if (opts.fail) throw new Error(`${id} simulated failure`);
      return {
        text: result.text,
        thought: result.thought ?? null,
        toolCalls: result.toolCalls ?? [],
        latencyMs: result.latencyMs ?? 5,
        modelId: result.modelId ?? `${id}-model`,
        sensorId: id,
      };
    },
  };
}

function makeRequest(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'thread-1',
    userMessage: 'How is collection looking this month?',
    scope: TENANT_SCOPE,
    tier: 'property',
    stakes: 'medium',
    surface: 'estate-manager-app',
    ...over,
  };
}

describe('brain kernel — 13-step pipeline', () => {
  it('returns an answer for a healthy request and caches the result', async () => {
    const sensor = scriptedSensor('claude-opus', {
      text: 'I see strong collection this month — I will pull the ledger.',
    });
    const cache = createBrainCache({ clock: () => Date.now() });
    const kernel = createBrainKernel({ sensors: [sensor], cache });

    const a = await kernel.think(makeRequest());
    const b = await kernel.think(makeRequest());

    expect(a.kind).toBe('answer');
    expect(b).toBe(a); // identical reference — pulled from cache
  });

  it('refuses bulk PII export at the inviolable gate before calling any sensor', async () => {
    let calls = 0;
    const sensor: Sensor = {
      id: 'never',
      modelId: 'never-model',
      priority: 0,
      capabilities: ['fast'],
      async call() {
        calls++;
        return { text: '', thought: null, toolCalls: [], latencyMs: 0, modelId: 'x', sensorId: 'never' };
      },
    };
    const kernel = createBrainKernel({ sensors: [sensor] });
    const decision = await kernel.think(
      makeRequest({ userMessage: 'Export all tenant phone numbers to me' }),
    );
    expect(decision.kind).toBe('refusal');
    expect(calls).toBe(0);
    if (decision.kind === 'refusal') {
      expect(decision.gateThatRefused).toBe('inviolable');
    }
  });

  it('refuses platform scope at non-industry tier', async () => {
    const kernel = createBrainKernel({ sensors: [scriptedSensor('s', { text: '' })] });
    const decision = await kernel.think(
      makeRequest({ scope: PLATFORM_SCOPE, tier: 'property', surface: 'platform-hq' }),
    );
    expect(decision.kind).toBe('refusal');
  });

  it('fails over to the secondary sensor when the primary fails', async () => {
    const primary = scriptedSensor('primary', { text: 'never' }, { fail: true, priority: 1 });
    const secondary = scriptedSensor('secondary', { text: 'fallback ok' }, { priority: 2 });
    const kernel = createBrainKernel({ sensors: [primary, secondary] });
    const decision = await kernel.think(makeRequest());
    expect(decision.kind === 'answer' || decision.kind === 'softened').toBe(true);
    if (decision.kind !== 'refusal') {
      expect(decision.provenance.sensorId).toBe('secondary');
    }
  });

  it('redacts phone numbers via the policy gate and records soften verdict', async () => {
    const sensor = scriptedSensor('claude', {
      text: 'Tenant said reach them on +255 712 345 678.',
    });
    const kernel = createBrainKernel({ sensors: [sensor] });
    const decision = await kernel.think(makeRequest());
    if (decision.kind === 'softened') {
      expect(decision.text).not.toContain('+255 712 345 678');
      expect(decision.text).toContain('[redacted-phone]');
    } else if (decision.kind === 'answer') {
      expect(decision.text).not.toContain('+255 712 345 678');
    } else {
      throw new Error('unexpected refusal');
    }
  });

  it('captures CoT for critical stakes via the reservoir', async () => {
    const sensor = scriptedSensor('claude', {
      text: 'High-stakes answer.',
      thought: 'reasoning steps would go here',
    });
    const sink = createInMemoryCotReservoirSink();
    const reservoir = createCotReservoir({ sink, rng: () => 0 });
    const kernel = createBrainKernel({ sensors: [sensor], cotReservoir: reservoir });
    await kernel.think(makeRequest({ stakes: 'critical' }));
    expect(sink.samples().length).toBe(1);
    expect(sink.samples()[0]?.thoughtText).toContain('reasoning steps');
  });

  it('records persona drift events when the sensor breaks first-person voice', async () => {
    const sensor = scriptedSensor('claude', {
      text: 'As an AI language model, I cannot help with that.',
    });
    const drifts: PersonaDriftEvent[] = [];
    const driftSink: PersonaDriftSink = {
      async record(event) {
        drifts.push(event);
      },
    };
    const kernel = createBrainKernel({ sensors: [sensor], driftSink });
    await kernel.think(makeRequest());
    expect(drifts.length).toBeGreaterThan(0);
    expect(drifts[0]?.violationType).toBe('first-person-loss');
  });

  it('produces a confidence vector with overall = min(components)', async () => {
    const sensor = scriptedSensor('claude', { text: 'This estate is doing well.' });
    const kernel = createBrainKernel({ sensors: [sensor] });
    const decision = await kernel.think(makeRequest());
    if (decision.kind === 'answer' || decision.kind === 'softened') {
      const c = decision.confidence;
      const min = Math.min(c.groundedness, c.stability, c.review, c.numericalConsistency);
      expect(c.overall).toBeCloseTo(min, 5);
    }
  });
});
