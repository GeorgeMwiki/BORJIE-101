/**
 * Kernel composition — D5 rollout controller integration smoke test.
 *
 * Verifies the kernel:
 *   - consults `rolloutController.pickPrompt(...)` when wired
 *   - mixes the resolved `promptText` into the composed system prompt
 *     (visible via the sensor invocation we inject as a spy)
 *   - falls back cleanly when the controller returns null (no-op)
 *   - falls back cleanly when the controller throws (no-op)
 *
 * We exercise this through a minimal sensor stub so the assertion can
 * read the system-prompt verbatim — no LLM call.
 */
import { describe, it, expect } from 'vitest';
import { createBrainKernel } from '../../kernel.js';
import type {
  Sensor,
  SensorCallArgs,
  SensorCallResult,
  ThoughtRequest,
} from '../../kernel-types.js';
import type { ScopeContext } from '../../../types.js';
import type { RolloutController } from '../rollout-controller.js';

function makeSpySensor(): { sensor: Sensor; calls: SensorCallArgs[] } {
  const calls: SensorCallArgs[] = [];
  const sensor: Sensor = {
    name: 'spy',
    capabilities: ['text'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      calls.push(args);
      return {
        ok: true,
        text: 'spy-response',
        durationMs: 1,
        tokensIn: 10,
        tokensOut: 5,
        microdollars: 100,
        provider: 'spy',
        model: 'spy-1',
      };
    },
  };
  return { sensor, calls };
}

const TENANT: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_1',
  actorUserId: 'u_alice',
  roles: ['estate-manager'],
  personaId: 'estate-manager',
};

function makeRequest(): ThoughtRequest {
  return {
    threadId: 'thr_1',
    userMessage: 'hello',
    scope: TENANT,
    tier: 'safe',
    stakes: 'low',
    surface: 'admin' as never,
  } as ThoughtRequest;
}

describe('kernel composition + rollout controller', () => {
  it('mixes the rollout-resolved prompt text into the system prompt', async () => {
    const { sensor, calls } = makeSpySensor();
    const controller: RolloutController = {
      async pickPrompt() {
        return {
          version: 'v42',
          promptText: 'D5_ROLLOUT_PROMPT_MARKER',
          variant: 'active',
          bucket: 0,
          source: 'registry',
        };
      },
    };
    const kernel = createBrainKernel({
      sensors: [sensor],
      rolloutController: controller,
    });
    await kernel.think(makeRequest());
    expect(calls.length).toBeGreaterThan(0);
    const systemPrompt = String(calls[0]!.systemPrompt ?? '');
    expect(systemPrompt).toContain('D5_ROLLOUT_PROMPT_MARKER');
  });

  it('falls back cleanly when the controller returns null', async () => {
    const { sensor, calls } = makeSpySensor();
    const controller: RolloutController = {
      async pickPrompt() {
        return null;
      },
    };
    const kernel = createBrainKernel({
      sensors: [sensor],
      rolloutController: controller,
    });
    await kernel.think(makeRequest());
    expect(calls.length).toBeGreaterThan(0);
    const systemPrompt = String(calls[0]!.systemPrompt ?? '');
    // The system prompt should still be non-empty (identity preamble +
    // module inventory etc.), just without the rollout marker.
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(systemPrompt).not.toContain('D5_ROLLOUT_PROMPT_MARKER');
  });

  it('falls back cleanly when the controller throws', async () => {
    const { sensor, calls } = makeSpySensor();
    const controller: RolloutController = {
      async pickPrompt() {
        throw new Error('boom');
      },
    };
    const kernel = createBrainKernel({
      sensors: [sensor],
      rolloutController: controller,
    });
    await expect(kernel.think(makeRequest())).resolves.toBeTruthy();
    expect(calls.length).toBeGreaterThan(0);
  });

  it('operates normally when no rolloutController is wired', async () => {
    const { sensor, calls } = makeSpySensor();
    const kernel = createBrainKernel({ sensors: [sensor] });
    await kernel.think(makeRequest());
    expect(calls.length).toBeGreaterThan(0);
  });
});
