/**
 * Compounding loop — `composeSovereign` forwards the task-scoped
 * `reflexionLoader` to the kernel, closing the READ-back side.
 *
 * Before this wire, `SovereignComposeConfig` declared + forwarded only
 * `reflexionRetriever` and `reflexionWriter`; a `reflexionLoader` handed
 * to compose was SILENTLY DROPPED, so the kernel's read-back step (F11,
 * kernel.ts ~1429) never saw the consolidated lessons. These tests prove:
 *
 *   1. a loader supplied to `composeSovereign(...)` reaches the kernel and
 *      its `recentGuidelines` body lands in the system prompt under the
 *      "Recent self-critiques" block; and
 *   2. a loader that throws is swallowed (side-channel) — the turn still
 *      produces an answer and the block is omitted.
 *
 * This is the end-to-end read-back proof: write → consolidate → read-back.
 */

import { describe, it, expect } from 'vitest';
import { composeSovereign } from '../compose.js';
import type {
  ReflexionLoaderPort,
  LoadedGuideline,
} from '../reflexion/reflexion-loader.js';
import type {
  Sensor,
  SensorCallArgs,
  SensorCallResult,
  ThoughtRequest,
} from '../kernel-types.js';
import type { ScopeContext } from '../../types.js';

const TENANT_SCOPE: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_reflexion',
  actorUserId: 'u_reflexion',
  roles: ['estate-manager'],
  personaId: 'estate-manager-head',
};

function makeRequest(over: Partial<ThoughtRequest> = {}): ThoughtRequest {
  return {
    threadId: 'th-reflexion-1',
    userMessage: 'what is the arrears position',
    scope: TENANT_SCOPE,
    tier: 'site',
    stakes: 'low',
    surface: 'estate-manager-app',
    ...over,
  };
}

/** Sensor that captures the system prompt it was called with. */
function spySensor(answer: string): {
  sensor: Sensor;
  seen: { lastSystem: string };
} {
  const seen = { lastSystem: '' };
  const sensor: Sensor = {
    id: 'spy-sensor',
    modelId: 'spy-model',
    priority: 1,
    capabilities: ['fast', 'thinking'],
    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      seen.lastSystem = args.system ?? '';
      return {
        text: answer,
        thought: null,
        toolCalls: [],
        latencyMs: 1,
        modelId: 'spy-model',
        sensorId: 'spy-sensor',
      };
    },
  };
  return { sensor, seen };
}

const sampleGuideline: LoadedGuideline = {
  id: 'g-arrears',
  tenantId: 't_reflexion',
  userId: null,
  slug: 'cite-source-row-on-arrears',
  body: 'When asked for arrears, always cite the source ledger row id.',
  confidence: 0.92,
  updatedAt: '2026-05-21T00:00:00Z',
};

describe('composeSovereign — reflexionLoader read-back passthrough', () => {
  it('folds a loaded guideline into the system prompt (loop closed)', async () => {
    const { sensor, seen } = spySensor('Arrears cited with row id.');
    const reflexionLoader: ReflexionLoaderPort = {
      async recentReflexions() {
        return [];
      },
      async recentGuidelines() {
        return [sampleGuideline];
      },
    };

    const sov = composeSovereign({
      extraSensors: [sensor],
      reflexionLoader,
    });
    await sov.kernel.think(makeRequest());

    // The loaded guideline body rode the read-back path into the prompt.
    expect(seen.lastSystem).toContain('Recent self-critiques');
    expect(seen.lastSystem).toContain('cite the source ledger row id');
  });

  it('swallows a throwing loader and still answers (side-channel)', async () => {
    const { sensor, seen } = spySensor('Loader threw; kernel continued.');
    const reflexionLoader: ReflexionLoaderPort = {
      async recentReflexions() {
        throw new Error('boom');
      },
      async recentGuidelines() {
        throw new Error('boom');
      },
    };

    const sov = composeSovereign({
      extraSensors: [sensor],
      reflexionLoader,
    });
    const decision = await sov.kernel.think(makeRequest());

    expect(decision.kind).toBe('answer');
    expect(seen.lastSystem).not.toContain('Recent self-critiques');
  });

  it('omits the block entirely when no loader is supplied (back-compat)', async () => {
    const { sensor, seen } = spySensor('No loader wired.');
    const sov = composeSovereign({ extraSensors: [sensor] });
    await sov.kernel.think(makeRequest());
    expect(seen.lastSystem).not.toContain('Recent self-critiques');
  });
});
