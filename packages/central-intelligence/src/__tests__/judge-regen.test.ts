/**
 * Tests for Wave-K parity: judge-driven regen-on-low-score.
 *
 * Mirrors LITFIN's brain-kernel.ts:1190-1240 behaviour. The kernel
 * MUST call the sensor a second time (exactly once) when the judge
 * scores < 0.5 AND stakes ≥ medium, baking the judge's reasonText /
 * suggestedFix into the system prompt for the regen.
 */

import { describe, it, expect, vi } from 'vitest';
import { createBrainKernel } from '../kernel/kernel.js';
import {
  createInMemoryCotReservoirSink,
  createCotReservoir,
} from '../kernel/cot-reservoir.js';
import type {
  Sensor,
  SensorCallArgs,
  SensorCallResult,
  ThoughtRequest,
} from '../kernel/kernel-types.js';
import type { ScopeContext } from '../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_demo',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function makeReq(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'thread-1',
    userMessage: 'How is rent recon this month?',
    scope: TENANT_SCOPE,
    tier: 'property',
    stakes: 'medium',
    surface: 'estate-manager-app',
    requireJudge: true,
    ...over,
  };
}

function trackedSensor(replies: ReadonlyArray<string>): {
  sensor: Sensor;
  calls: Array<{ args: SensorCallArgs; reply: string }>;
} {
  const calls: Array<{ args: SensorCallArgs; reply: string }> = [];
  let idx = 0;
  const sensor: Sensor = {
    id: 'tracked',
    modelId: 'tracked-model',
    priority: 10,
    capabilities: ['thinking', 'fast'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      const reply = replies[Math.min(idx, replies.length - 1)] ?? 'fallback';
      idx += 1;
      calls.push({ args, reply });
      return {
        text: reply,
        thought: null,
        toolCalls: [],
        latencyMs: 5,
        modelId: 'tracked-model',
        sensorId: 'tracked',
      };
    },
  };
  return { sensor, calls };
}

describe('Wave-K judge regen-on-low-score', () => {
  it('calls the sensor exactly once when the first draft scores ≥ 0.5', async () => {
    const { sensor, calls } = trackedSensor(['Good first draft.']);
    const judge = vi.fn(async () => ({ score: 0.85, reasonText: 'looks fine', suggestedFix: '' }));
    const kernel = createBrainKernel({ sensors: [sensor], judge });
    const decision = await kernel.think(makeReq({ stakes: 'medium', requireJudge: true }));
    expect(calls.length).toBe(1);
    expect(judge).toHaveBeenCalledTimes(1);
    if (decision.kind === 'answer' || decision.kind === 'softened') {
      expect(decision.provenance.judgeScore).toBeCloseTo(0.85, 5);
    }
  });

  it('regenerates once when judge scores < 0.5 at stakes=medium', async () => {
    const { sensor, calls } = trackedSensor(['Bad first draft.', 'Polished second draft.']);
    let judgeCall = 0;
    const judge = vi.fn(async () => {
      judgeCall += 1;
      return judgeCall === 1
        ? { score: 0.2, reasonText: 'fabricated', suggestedFix: 'Cite the source ledger.' }
        : { score: 0.8, reasonText: 'better', suggestedFix: '' };
    });
    const kernel = createBrainKernel({ sensors: [sensor], judge });
    const decision = await kernel.think(makeReq({ stakes: 'medium', requireJudge: true }));
    expect(calls.length).toBe(2);
    // Second call should carry the judge fix in the system prompt.
    expect(calls[1]?.args.system).toContain('Cite the source ledger.');
    expect(calls[1]?.args.system).toMatch(/score=0\.20/);
    expect(judge).toHaveBeenCalledTimes(2);
    if (decision.kind === 'answer' || decision.kind === 'softened') {
      expect(decision.provenance.judgeScore).toBeCloseTo(0.8, 5);
    }
  });

  it('does NOT regenerate when stakes=low even if judge scores low', async () => {
    const { sensor, calls } = trackedSensor(['Bad draft.']);
    const judge = vi.fn(async () => ({ score: 0.1, reasonText: 'fabricated', suggestedFix: 'Cite.' }));
    const kernel = createBrainKernel({ sensors: [sensor], judge });
    await kernel.think(makeReq({ stakes: 'low', requireJudge: true }));
    expect(calls.length).toBe(1);
    // Judge runs once because requireJudge=true; no regen because stakes=low.
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('caps regen at exactly one attempt — no infinite loop', async () => {
    const { sensor, calls } = trackedSensor(['First.', 'Second still bad.']);
    let judgeCall = 0;
    const judge = vi.fn(async () => {
      judgeCall += 1;
      return { score: 0.1, reasonText: 'still bad', suggestedFix: 'try harder' };
    });
    const kernel = createBrainKernel({ sensors: [sensor], judge });
    // estimatedCostUsd=0 opts out of the default post-judge 3-agent
    // debate so this regen-path test still sees exactly 2 sensor calls.
    await kernel.think(makeReq({ stakes: 'high', requireJudge: true, estimatedCostUsd: 0 }));
    expect(calls.length).toBe(2); // original + 1 regen, never 3
    expect(judge).toHaveBeenCalledTimes(2); // original + re-judge of regen
  });

  it('survives a sensor throw during regen — keeps the original result', async () => {
    let sensorCall = 0;
    const sensor: Sensor = {
      id: 'flaky',
      modelId: 'flaky-model',
      priority: 10,
      capabilities: ['thinking', 'fast'],
      async call(): Promise<SensorCallResult> {
        sensorCall += 1;
        if (sensorCall === 1) {
          return {
            text: 'Original draft.',
            thought: null,
            toolCalls: [],
            latencyMs: 5,
            modelId: 'flaky-model',
            sensorId: 'flaky',
          };
        }
        throw new Error('regen explode');
      },
    };
    const judge = vi.fn(async () => ({ score: 0.1, reasonText: 'bad', suggestedFix: 'try' }));
    const kernel = createBrainKernel({ sensors: [sensor], judge });
    // estimatedCostUsd=0 opts out of the default post-judge 3-agent
    // debate so this regen-fault test still asserts exactly 2 calls.
    const decision = await kernel.think(makeReq({ stakes: 'high', requireJudge: true, estimatedCostUsd: 0 }));
    expect(sensorCall).toBe(2);
    // Decision should still resolve (regen failure is swallowed).
    expect(decision.kind === 'answer' || decision.kind === 'softened' || decision.kind === 'refusal').toBe(true);
  });

  it('accepts a judge that returns reasons[] for backward compatibility', async () => {
    const { sensor, calls } = trackedSensor(['First.', 'Better.']);
    let i = 0;
    const judge = vi.fn(async () => {
      i += 1;
      return i === 1
        ? { score: 0.3, reasonText: 'multiple issues' }
        : { score: 0.9, reasonText: '' };
    });
    const kernel = createBrainKernel({ sensors: [sensor], judge });
    // estimatedCostUsd=0 opts out of the default post-judge 3-agent
    // debate so the regen call count remains 2.
    await kernel.think(makeReq({ stakes: 'high', requireJudge: true, estimatedCostUsd: 0 }));
    expect(calls.length).toBe(2);
    expect(calls[1]?.args.system).toContain('multiple issues');
  });
});

describe('Wave-K Anthropic judge — new return shape', () => {
  it('returns {score, reasonText, suggestedFix} when the model emits them', async () => {
    const { createAnthropicJudge } = await import('../kernel/sensors/anthropic-judge.js');
    const stubClient = {
      messages: {
        async create() {
          return {
            id: 'm_1',
            model: 'claude-haiku-4-5-20251001',
            stop_reason: 'end_turn',
            content: [
              {
                type: 'text',
                text: '{"score": 0.4, "reasonText": "uncited percentage", "suggestedFix": "Hedge with a verify-against-ledger note."}',
              },
            ],
          };
        },
      },
    };
    const judge = createAnthropicJudge(stubClient as never);
    const out = await judge('Some draft.');
    expect(out.score).toBeCloseTo(0.4, 5);
    expect(out.reasonText).toContain('uncited');
    expect(out.suggestedFix).toContain('Hedge');
  });

  it('falls back to legacy reasons[] array when reasonText missing', async () => {
    const { createAnthropicJudge } = await import('../kernel/sensors/anthropic-judge.js');
    const stubClient = {
      messages: {
        async create() {
          return {
            id: 'm_2',
            model: 'haiku',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: '{"score": 0.7, "reasons": ["a", "b"]}' }],
          };
        },
      },
    };
    const judge = createAnthropicJudge(stubClient as never);
    const out = await judge('draft');
    expect(out.score).toBeCloseTo(0.7, 5);
    expect(out.reasonText).toBe('a; b');
    expect(out.suggestedFix).toBe('');
  });
});

describe('Wave-K CoT PII scrub', () => {
  it('strips a TZ phone number from thought text before persistence', async () => {
    const sensor: Sensor = {
      id: 'sensor',
      modelId: 'm',
      priority: 10,
      capabilities: ['thinking', 'fast'],
      async call() {
        return {
          text: 'ok',
          thought: 'Tenant phone +255 712 345 678 called twice today.',
          toolCalls: [],
          latencyMs: 1,
          modelId: 'm',
          sensorId: 'sensor',
        };
      },
    };
    const sink = createInMemoryCotReservoirSink();
    const reservoir = createCotReservoir({ sink, rng: () => 0 });
    const kernel = createBrainKernel({ sensors: [sensor], cotReservoir: reservoir });
    await kernel.think(makeReq({ stakes: 'critical', requireJudge: false }));
    expect(sink.samples().length).toBe(1);
    const sample = sink.samples()[0]!;
    expect(sample.thoughtText).not.toContain('+255');
    expect(sample.thoughtText).toContain('[redacted-phone]');
    // hash columns populated
    expect(sample.promptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sample.responseHash).toMatch(/^[a-f0-9]{64}$/);
    // and the hashes differ (PII removed → content changed)
    expect(sample.promptHash).not.toBe(sample.responseHash);
  });

  it('strips a KRA PIN and a NIDA from the same thought', async () => {
    const sensor: Sensor = {
      id: 'sensor',
      modelId: 'm',
      priority: 10,
      capabilities: ['thinking', 'fast'],
      async call() {
        return {
          text: 'ok',
          thought: 'KRA PIN A123456789B and NIDA 19851234-12345-12345-12 on file.',
          toolCalls: [],
          latencyMs: 1,
          modelId: 'm',
          sensorId: 'sensor',
        };
      },
    };
    const sink = createInMemoryCotReservoirSink();
    const reservoir = createCotReservoir({ sink, rng: () => 0 });
    const kernel = createBrainKernel({ sensors: [sensor], cotReservoir: reservoir });
    await kernel.think(makeReq({ stakes: 'critical' }));
    const sample = sink.samples()[0]!;
    expect(sample.thoughtText).toContain('[redacted-kra-pin]');
    expect(sample.thoughtText).toContain('[redacted-nida]');
  });
});
