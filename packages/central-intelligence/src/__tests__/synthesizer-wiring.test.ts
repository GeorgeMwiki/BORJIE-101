/**
 * Multi-LLM synthesizer wiring tests.
 *
 * Mounts the brain kernel through `composeSovereign` with a stub
 * sensor and a hand-rolled `MultiLLMSynthesizerPort`, then asserts:
 *
 *   1. When `req.requireSynthesis === true` AND the synthesizer is
 *      wired, the kernel calls `synthesizer.synthesize(...)` exactly
 *      once and uses its `content` as the answer (single sensor call
 *      is NOT made on this turn).
 *   2. When `req.requireSynthesis !== true`, the synthesizer is never
 *      invoked even when wired — the single-shot sensor path runs.
 *   3. When the synthesizer throws, the kernel falls back to the
 *      single-shot sensor path and still returns a decision.
 *   4. The optional `shouldSynthesize(req)` gate can short-circuit
 *      the detour even when the flag is on (tier ceiling).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  composeSovereign,
  type MultiLLMSynthesizerPort,
  type MultiLLMSynthesizerCall,
  type MultiLLMSynthesizerResult,
  type ScopeContext,
  type Sensor,
  type SensorCallArgs,
  type SensorCallResult,
  type ThoughtRequest,
} from '../kernel/index.js';

const SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_demo',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function captureSensor(opts: { reply?: string } = {}): {
  sensor: Sensor;
  callCount: () => number;
} {
  let calls = 0;
  const sensor: Sensor = {
    id: 'capture',
    modelId: 'capture-1',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(_args: SensorCallArgs): Promise<SensorCallResult> {
      calls += 1;
      return {
        text: opts.reply ?? 'single-shot ack',
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'capture-1',
        sensorId: 'capture',
      };
    },
  };
  return { sensor, callCount: () => calls };
}

function makeRequest(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'th_synth_1',
    userMessage: 'Draft an eviction letter respecting the 60-day notice period.',
    scope: SCOPE,
    tier: 'tenant',
    stakes: 'high',
    surface: 'estate-manager-app',
    ...over,
  };
}

describe('multi-llm-synthesizer kernel wire-up', () => {
  it('routes to the synthesizer when requireSynthesis=true and uses its content', async () => {
    const { sensor, callCount } = captureSensor();
    const synthesize = vi
      .fn<
        (args: MultiLLMSynthesizerCall) => Promise<MultiLLMSynthesizerResult>
      >()
      .mockResolvedValue({
        content: 'synthesized merged answer with cross-vendor agreement',
        proposerSuccessCount: 3,
        proposerFailureCount: 0,
        agreement: 0.82,
        escalate: false,
        synthesizerFallback: false,
        modelId: 'claude-opus-4-6',
        latencyMs: 250,
      });
    const synthesizer: MultiLLMSynthesizerPort = { synthesize };

    const sov = composeSovereign({ extraSensors: [sensor], synthesizer });
    const decision = await sov.kernel.think(makeRequest({ requireSynthesis: true }));

    expect(synthesize).toHaveBeenCalledTimes(1);
    // The single-shot sensor must NOT have been called on this turn.
    expect(callCount()).toBe(0);
    // The kernel returns either 'answer' or 'softened'; never 'refusal'
    // on this happy path. Either way, the content flows through unchanged.
    if (decision.kind === 'refusal') {
      throw new Error(`unexpected refusal: ${decision.reason}`);
    }
    expect(decision.text).toContain('synthesized merged answer');
  });

  it('does NOT call the synthesizer when requireSynthesis is omitted', async () => {
    const { sensor, callCount } = captureSensor({ reply: 'plain reply' });
    const synthesize = vi
      .fn<
        (args: MultiLLMSynthesizerCall) => Promise<MultiLLMSynthesizerResult>
      >()
      .mockResolvedValue({
        content: 'should NOT be used',
        proposerSuccessCount: 0,
        proposerFailureCount: 0,
        agreement: 1,
        escalate: false,
        synthesizerFallback: false,
        modelId: 'unused',
        latencyMs: 0,
      });
    const synthesizer: MultiLLMSynthesizerPort = { synthesize };

    const sov = composeSovereign({ extraSensors: [sensor], synthesizer });
    const decision = await sov.kernel.think(makeRequest());

    expect(synthesize).not.toHaveBeenCalled();
    expect(callCount()).toBe(1);
    if (decision.kind === 'refusal') {
      throw new Error(`unexpected refusal: ${decision.reason}`);
    }
    expect(decision.text).toContain('plain reply');
  });

  it('falls back to single-shot when the synthesizer throws', async () => {
    const { sensor, callCount } = captureSensor({ reply: 'fallback ok' });
    const synthesize = vi
      .fn<
        (args: MultiLLMSynthesizerCall) => Promise<MultiLLMSynthesizerResult>
      >()
      .mockRejectedValue(new Error('all proposers failed'));
    const synthesizer: MultiLLMSynthesizerPort = { synthesize };

    const sov = composeSovereign({ extraSensors: [sensor], synthesizer });
    const decision = await sov.kernel.think(makeRequest({ requireSynthesis: true }));

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(callCount()).toBe(1); // single-shot sensor fallback ran
    if (decision.kind === 'refusal') {
      throw new Error(`unexpected refusal: ${decision.reason}`);
    }
    expect(decision.text).toContain('fallback ok');
  });

  it('honours shouldSynthesize(req) as a hard gate even when the flag is on', async () => {
    const { sensor, callCount } = captureSensor({ reply: 'low-tier reply' });
    const synthesize = vi
      .fn<
        (args: MultiLLMSynthesizerCall) => Promise<MultiLLMSynthesizerResult>
      >()
      .mockResolvedValue({
        content: 'should NOT be reached',
        proposerSuccessCount: 0,
        proposerFailureCount: 0,
        agreement: 1,
        escalate: false,
        synthesizerFallback: false,
        modelId: 'unused',
        latencyMs: 0,
      });
    const synthesizer: MultiLLMSynthesizerPort = {
      shouldSynthesize: (req) => req.stakes === 'critical',
      synthesize,
    };

    const sov = composeSovereign({ extraSensors: [sensor], synthesizer });
    const decision = await sov.kernel.think(
      makeRequest({ requireSynthesis: true, stakes: 'medium' }),
    );

    expect(synthesize).not.toHaveBeenCalled();
    expect(callCount()).toBe(1);
    if (decision.kind === 'refusal') {
      throw new Error(`unexpected refusal: ${decision.reason}`);
    }
    expect(decision.text).toContain('low-tier reply');
  });
});
