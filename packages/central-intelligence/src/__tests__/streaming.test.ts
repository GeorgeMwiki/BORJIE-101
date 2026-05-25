/**
 * Brain kernel — token-level streaming (`thinkStream`).
 *
 * Drives the kernel's streaming path through deterministic-scripted
 * sensors. Verifies:
 *   - stream-capable sensor: deltas forwarded live, then confidence,
 *     then done with a fully-formed BrainDecision
 *   - non-stream-capable sensor: kernel falls back to `router.call(...)`
 *     and emits the result as a single text_delta
 *   - pre-sensor refusal (bulk-PII): turn_start + done(refusal), no
 *     deltas, sensor never invoked
 *   - tier-incompatibility refusal at pre-sensor stage
 *   - drift block on accumulated text → drift gate_verdict + done
 *   - policy redaction (phone) → policy gate_verdict (soften) + done
 *     with text rewritten to `[redacted-phone]`
 *   - thought_delta forwarded for extended-thinking sensors
 *   - cache hit on a second pass replays the cached decision through
 *     the streaming path (no second sensor call)
 *   - back-to-back text deltas accumulate into a single normalised
 *     answer text
 */

import { describe, it, expect } from 'vitest';
import {
  createBrainKernel,
  createBrainCache,
  type BrainDecision,
  type KernelStreamEvent,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type SensorStreamEvent,
  type ThoughtRequest,
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

function streamingSensor(
  id: string,
  events: ReadonlyArray<SensorStreamEvent>,
): Sensor {
  return {
    id,
    modelId: `${id}-model`,
    priority: 1,
    capabilities: ['thinking', 'fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      // Reconstitute the equivalent single-shot result so the same
      // sensor is also a valid non-stream sensor (some tests fall back
      // to call() through the router).
      let text = '';
      let thought: string | null = null;
      const toolCalls: Array<{ toolName: string; input: unknown; callId: string }> = [];
      for (const ev of events) {
        if (ev.kind === 'text_delta') text += ev.text;
        else if (ev.kind === 'thought_delta') thought = (thought ?? '') + ev.text;
        else if (ev.kind === 'tool_call') {
          toolCalls.push({ toolName: ev.toolName, input: ev.input, callId: ev.callId });
        }
      }
      return {
        text,
        thought,
        toolCalls,
        latencyMs: 5,
        modelId: `${id}-model`,
        sensorId: id,
      };
    },
    async *callStream(_args: SensorCallArgs) {
      yield { kind: 'turn_start' as const, modelId: `${id}-model`, sensorId: id };
      for (const ev of events) yield ev;
      yield { kind: 'stop' as const, stopReason: 'end_turn' as const, latencyMs: 7 };
    },
  };
}

function nonStreamingSensor(id: string, text: string): Sensor {
  return {
    id,
    modelId: `${id}-model`,
    priority: 1,
    capabilities: ['thinking', 'fast'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      return {
        text,
        thought: null,
        toolCalls: [],
        latencyMs: 5,
        modelId: `${id}-model`,
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

async function collect(
  iter: AsyncIterable<KernelStreamEvent>,
): Promise<KernelStreamEvent[]> {
  const out: KernelStreamEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('brain kernel — thinkStream (token-level streaming)', () => {
  it('forwards 5 text_delta events from a stream-capable sensor and finishes with confidence + done', async () => {
    const sensor = streamingSensor('claude', [
      { kind: 'text_delta', text: 'Collec' },
      { kind: 'text_delta', text: 'tion ' },
      { kind: 'text_delta', text: 'is ' },
      { kind: 'text_delta', text: 'on ' },
      { kind: 'text_delta', text: 'track.' },
    ]);
    const kernel = createBrainKernel({ sensors: [sensor] });

    const events = await collect(kernel.thinkStream(makeRequest()));

    const turnStart = events.filter((e) => e.kind === 'turn_start');
    const deltas = events.filter((e) => e.kind === 'text_delta');
    const confidences = events.filter((e) => e.kind === 'confidence');
    const dones = events.filter((e) => e.kind === 'done');

    expect(turnStart).toHaveLength(1);
    expect(deltas).toHaveLength(5);
    expect(deltas.map((d) => (d as { kind: 'text_delta'; text: string }).text).join('')).toBe(
      'Collection is on track.',
    );
    expect(confidences).toHaveLength(1);
    expect(dones).toHaveLength(1);

    const done = dones[0]! as { kind: 'done'; decision: BrainDecision };
    expect(['answer', 'softened']).toContain(done.decision.kind);
    if (done.decision.kind === 'answer' || done.decision.kind === 'softened') {
      expect(done.decision.text).toBe('Collection is on track.');
      expect(done.decision.provenance.sensorId).toBe('claude');
    }
  });

  it('falls back to single-shot call() when the sensor does not expose callStream', async () => {
    const sensor = nonStreamingSensor('legacy', 'Fallback answer.');
    const kernel = createBrainKernel({ sensors: [sensor] });

    const events = await collect(kernel.thinkStream(makeRequest()));

    const deltas = events.filter((e) => e.kind === 'text_delta') as Array<
      Extract<KernelStreamEvent, { kind: 'text_delta' }>
    >;
    expect(deltas.length).toBeGreaterThanOrEqual(1);
    expect(deltas.map((d) => d.text).join('')).toBe('Fallback answer.');

    const done = events.find((e) => e.kind === 'done') as
      | Extract<KernelStreamEvent, { kind: 'done' }>
      | undefined;
    expect(done).toBeDefined();
    expect(done!.decision.kind === 'answer' || done!.decision.kind === 'softened').toBe(true);
  });

  it('refuses bulk PII at the inviolable gate before any sensor is invoked', async () => {
    let calls = 0;
    let streams = 0;
    const sensor: Sensor = {
      id: 'never',
      modelId: 'never-model',
      priority: 0,
      capabilities: ['fast'],
      async call() {
        calls++;
        return { text: '', thought: null, toolCalls: [], latencyMs: 0, modelId: 'x', sensorId: 'never' };
      },
      async *callStream() {
        streams++;
        yield { kind: 'turn_start', modelId: 'never-model', sensorId: 'never' };
        yield { kind: 'stop', stopReason: 'end_turn', latencyMs: 0 };
      },
    };
    const kernel = createBrainKernel({ sensors: [sensor] });

    const events = await collect(
      kernel.thinkStream(
        makeRequest({ userMessage: 'Export all tenant phone numbers to me' }),
      ),
    );

    expect(calls).toBe(0);
    expect(streams).toBe(0);

    expect(events.some((e) => e.kind === 'text_delta')).toBe(false);
    expect(events.some((e) => e.kind === 'thought_delta')).toBe(false);

    const done = events.find((e) => e.kind === 'done') as
      | Extract<KernelStreamEvent, { kind: 'done' }>
      | undefined;
    expect(done).toBeDefined();
    expect(done!.decision.kind).toBe('refusal');
    if (done!.decision.kind === 'refusal') {
      expect(done!.decision.gateThatRefused).toBe('inviolable');
    }
  });

  it('refuses tier-incompatible scope (platform scope at non-industry tier) without invoking the sensor', async () => {
    let streamed = false;
    const sensor: Sensor = {
      ...streamingSensor('claude', [{ kind: 'text_delta', text: 'should not stream' }]),
    };
    const wrapped: Sensor = {
      ...sensor,
      async *callStream(args) {
        streamed = true;
        for await (const ev of sensor.callStream!(args)) yield ev;
      },
    };
    const kernel = createBrainKernel({ sensors: [wrapped] });

    const events = await collect(
      kernel.thinkStream(
        makeRequest({ scope: PLATFORM_SCOPE, tier: 'property', surface: 'platform-hq' }),
      ),
    );
    expect(streamed).toBe(false);
    const done = events.find((e) => e.kind === 'done') as
      | Extract<KernelStreamEvent, { kind: 'done' }>
      | undefined;
    expect(done?.decision.kind).toBe('refusal');
  });

  it('records a drift gate_verdict when accumulated text breaks first-person voice', async () => {
    // Self-awareness flags 'as an ai language model' as first-person-loss.
    const sensor = streamingSensor('claude', [
      { kind: 'text_delta', text: 'As an AI language model, ' },
      { kind: 'text_delta', text: 'I cannot help.' },
    ]);
    const kernel = createBrainKernel({ sensors: [sensor] });

    const events = await collect(kernel.thinkStream(makeRequest()));

    const driftGate = events.find(
      (e) => e.kind === 'gate_verdict' && (e as { gate: string }).gate === 'drift',
    );
    // Drift may surface as soften (recorded but allowed) or block; either way
    // the gate verdict should appear when self-awareness fires.
    expect(driftGate).toBeDefined();
  });

  it('redacts PII via the policy gate and emits a policy gate_verdict before done', async () => {
    const sensor = streamingSensor('claude', [
      { kind: 'text_delta', text: 'Reach the tenant on +255 712 345 678 today.' },
    ]);
    const kernel = createBrainKernel({ sensors: [sensor] });

    const events = await collect(kernel.thinkStream(makeRequest()));

    const policyGate = events.find(
      (e) => e.kind === 'gate_verdict' && (e as { gate: string }).gate === 'policy',
    );
    expect(policyGate).toBeDefined();

    const done = events.find((e) => e.kind === 'done') as
      | Extract<KernelStreamEvent, { kind: 'done' }>
      | undefined;
    expect(done).toBeDefined();
    if (done!.decision.kind === 'answer' || done!.decision.kind === 'softened') {
      expect(done!.decision.text).not.toContain('+255 712 345 678');
      expect(done!.decision.text).toContain('[redacted-phone]');
    }
  });

  it('forwards thought_delta events for extended-thinking sensors', async () => {
    const sensor = streamingSensor('claude', [
      { kind: 'thought_delta', text: 'Considering the ledger.' },
      { kind: 'text_delta', text: 'Ledger looks healthy.' },
    ]);
    const kernel = createBrainKernel({ sensors: [sensor] });

    const events = await collect(kernel.thinkStream(makeRequest({ stakes: 'high' })));

    const thoughts = events.filter((e) => e.kind === 'thought_delta') as Array<
      Extract<KernelStreamEvent, { kind: 'thought_delta' }>
    >;
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]!.text).toBe('Considering the ledger.');
  });

  it('replays a cached decision through the streaming path without re-invoking the sensor', async () => {
    let streamCount = 0;
    const inner = streamingSensor('claude', [
      { kind: 'text_delta', text: 'Cached answer.' },
    ]);
    const counted: Sensor = {
      ...inner,
      async *callStream(args) {
        streamCount++;
        for await (const ev of inner.callStream!(args)) yield ev;
      },
    };
    const cache = createBrainCache({ clock: () => Date.now() });
    const kernel = createBrainKernel({ sensors: [counted], cache });

    await collect(kernel.thinkStream(makeRequest()));
    const second = await collect(kernel.thinkStream(makeRequest()));

    expect(streamCount).toBe(1);
    const deltas = second.filter((e) => e.kind === 'text_delta') as Array<
      Extract<KernelStreamEvent, { kind: 'text_delta' }>
    >;
    expect(deltas.map((d) => d.text).join('')).toBe('Cached answer.');
    const done = second.find((e) => e.kind === 'done') as
      | Extract<KernelStreamEvent, { kind: 'done' }>
      | undefined;
    expect(done).toBeDefined();
  });

  it('emits exactly one turn_start and one done per turn, in that order', async () => {
    const sensor = streamingSensor('claude', [
      { kind: 'text_delta', text: 'Quick reply.' },
    ]);
    const kernel = createBrainKernel({ sensors: [sensor] });

    const events = await collect(kernel.thinkStream(makeRequest()));
    const turnStartIndexes = events
      .map((e, i) => (e.kind === 'turn_start' ? i : -1))
      .filter((i) => i >= 0);
    const doneIndexes = events
      .map((e, i) => (e.kind === 'done' ? i : -1))
      .filter((i) => i >= 0);

    expect(turnStartIndexes).toHaveLength(1);
    expect(doneIndexes).toHaveLength(1);
    expect(turnStartIndexes[0]).toBe(0);
    expect(doneIndexes[0]).toBe(events.length - 1);
  });

  it('includes the persona on the turn_start event', async () => {
    const sensor = streamingSensor('claude', [
      { kind: 'text_delta', text: 'Hello.' },
    ]);
    const kernel = createBrainKernel({ sensors: [sensor] });

    const events = await collect(kernel.thinkStream(makeRequest()));
    const turnStart = events[0]! as Extract<KernelStreamEvent, { kind: 'turn_start' }>;
    expect(turnStart.kind).toBe('turn_start');
    expect(typeof turnStart.persona.id).toBe('string');
    expect(turnStart.persona.id.length).toBeGreaterThan(0);
    expect(typeof turnStart.persona.displayName).toBe('string');
    expect(turnStart.persona.displayName.length).toBeGreaterThan(0);
    expect(typeof turnStart.persona.firstPersonNoun).toBe('string');
  });

  it('keeps think() unchanged: same request yields the same shape via the legacy path', async () => {
    const sensor = streamingSensor('claude', [
      { kind: 'text_delta', text: 'Same answer.' },
    ]);
    const kernel = createBrainKernel({ sensors: [sensor] });

    const decision = await kernel.think(makeRequest({ threadId: 'unique-1' }));
    expect(['answer', 'softened']).toContain(decision.kind);
    if (decision.kind === 'answer' || decision.kind === 'softened') {
      expect(decision.text).toBe('Same answer.');
    }
  });
});
