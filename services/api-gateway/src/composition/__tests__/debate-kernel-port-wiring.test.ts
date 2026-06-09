/**
 * Wave-3 — kernel debate port wiring tests.
 *
 * Asserts the closure-plan invariants for the stakes-gated multi-voice
 * debate detour bound onto the MAIN kernel deps:
 *   - DISABLED by default: `shouldDebate` is false with the flag unset, so
 *     the kernel keeps its single-shot sensor path.
 *   - STAKES-GATED: even enabled, `shouldDebate` is true ONLY for
 *     high/critical stakes.
 *   - LIVE when enabled: `runDebate` drives the N-voice runner over the
 *     injected sensor and returns real contributions + a synthesis.
 *   - FAIL-SAFE: a sensor error / budget overrun yields an empty-
 *     contributions outcome (kernel falls back to single-shot); the port
 *     NEVER rejects.
 */

import { describe, expect, it } from 'vitest';

import {
  buildDebateKernelPort,
  type BuildDebatePortArgs,
} from '../debate-kernel-port-wiring';

// A minimal fake sensor: returns deterministic text, no network.
function fakeSensor(behaviour: 'ok' | 'throw' | 'slow') {
  return {
    id: 'fake-sensor',
    modelId: 'fake-model',
    priority: 1,
    capabilities: ['fast'] as const,
    async call(args: { userMessage: string }) {
      if (behaviour === 'throw') throw new Error('sensor down');
      if (behaviour === 'slow') {
        await new Promise((r) => setTimeout(r, 200));
      }
      return {
        text: `voice-reply to: ${args.userMessage.slice(0, 24)}`,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'fake-model',
        sensorId: 'fake-sensor',
      };
    },
  };
}

// `anthropic` is unused when a sensor is injected — pass a dummy object.
const DUMMY_ANTHROPIC = {} as BuildDebatePortArgs['anthropic'];

describe('buildDebateKernelPort', () => {
  it('shouldDebate is false when the flag is off (single-shot path kept)', () => {
    const { port, enabled } = buildDebateKernelPort({
      anthropic: DUMMY_ANTHROPIC,
      env: {},
      sensor: fakeSensor('ok'),
    });
    expect(enabled).toBe(false);
    expect(port.shouldDebate({ stakes: 'high' })).toBe(false);
    expect(port.shouldDebate({ stakes: 'critical' })).toBe(false);
  });

  it('shouldDebate is stakes-gated even when enabled', () => {
    const { port, enabled } = buildDebateKernelPort({
      anthropic: DUMMY_ANTHROPIC,
      env: { BORJIE_KERNEL_DEBATE_ENABLED: '1' },
      sensor: fakeSensor('ok'),
    });
    expect(enabled).toBe(true);
    expect(port.shouldDebate({ stakes: 'high' })).toBe(true);
    expect(port.shouldDebate({ stakes: 'critical' })).toBe(true);
    expect(port.shouldDebate({ stakes: 'low' })).toBe(false);
    expect(port.shouldDebate({ stakes: 'medium' })).toBe(false);
    expect(port.shouldDebate({})).toBe(false);
  });

  it('runDebate drives the N-voice runner and returns a real synthesis', async () => {
    const { port } = buildDebateKernelPort({
      anthropic: DUMMY_ANTHROPIC,
      env: { BORJIE_KERNEL_DEBATE_ENABLED: '1' },
      sensor: fakeSensor('ok'),
    });
    const outcome = await port.runDebate(
      'Should we suspend licence 42 given the arrears?',
      'Context: arrears 90 days, two prior warnings.',
    );
    expect(outcome.contributions.length).toBeGreaterThan(0);
    expect(typeof outcome.synthesis).toBe('string');
    expect(outcome.synthesis.length).toBeGreaterThan(0);
  });

  it('fail-safe: a sensor error yields an empty outcome, never rejects', async () => {
    const { port } = buildDebateKernelPort({
      anthropic: DUMMY_ANTHROPIC,
      env: { BORJIE_KERNEL_DEBATE_ENABLED: '1' },
      sensor: fakeSensor('throw'),
    });
    const outcome = await port.runDebate('q', 'ctx');
    expect(outcome.contributions).toEqual([]);
    expect(outcome.synthesis).toBe('');
  });

  it('fail-safe: a budget overrun yields an empty outcome (single-shot fallback)', async () => {
    const { port } = buildDebateKernelPort({
      anthropic: DUMMY_ANTHROPIC,
      env: {
        BORJIE_KERNEL_DEBATE_ENABLED: '1',
        BORJIE_KERNEL_DEBATE_BUDGET_MS: '5',
      },
      sensor: fakeSensor('slow'),
    });
    const outcome = await port.runDebate('q', 'ctx');
    expect(outcome.contributions).toEqual([]);
    expect(outcome.synthesis).toBe('');
  });
});
