/**
 * Provider shape + invocation tests for the remaining adapters.
 *
 * The `providers.test.ts` file covers Flux, Runway, Ideogram, Imagen
 * + dispatcher in depth. This file lifts coverage on the other 7
 * adapters by asserting their constants + a single mocked invocation
 * each.
 */

import { describe, expect, it } from 'vitest';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
  ProviderContext,
} from '../types.js';
import { BorjieBrandSpec } from '../brand-lock/brand-spec.js';
import { createCostTracker } from '../budgets/cost-tracker.js';
import { createSoraAdapter, SORA_NAME } from '../providers/sora-adapter.js';
import {
  createSeedanceAdapter,
  SEEDANCE_NAME,
} from '../providers/seedance-adapter.js';
import {
  createRecraftAdapter,
  RECRAFT_NAME,
} from '../providers/recraft-adapter.js';
import { createHedraAdapter, HEDRA_NAME } from '../providers/hedra-adapter.js';
import {
  createHeyGenAdapter,
  HEYGEN_NAME,
} from '../providers/heygen-adapter.js';
import {
  createFireflyAdapter,
  FIREFLY_NAME,
} from '../providers/firefly-adapter.js';
import { createSd35Adapter, SD35_NAME } from '../providers/sd35-adapter.js';

const RECIPE_KEY = {
  id: 'briefing_thumbnail',
  version: 1,
  class: 'briefing_thumbnail' as const,
  authority_tier: 0 as const,
  approval_required: false,
};

function makeCtx(fetchImpl: typeof fetch): ProviderContext {
  return {
    tenant_id: 't1',
    recipe_id: RECIPE_KEY.id,
    recipe_version: RECIPE_KEY.version,
    brand_spec: BorjieBrandSpec,
    cost_tracker: createCostTracker({ budget_usd_cents: 10_000 }),
    fetchImpl,
    seed: 'seed-1',
  };
}

const fetchOk = (body: string): typeof fetch =>
  (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

interface ShapeCase {
  readonly name: string;
  readonly env: string;
  readonly create: () => MediaProviderAdapter<MediaProviderInput, MediaArtifact>;
  readonly response: string;
  readonly input: MediaProviderInput;
  readonly expected_provider: string;
}

const CASES: ReadonlyArray<ShapeCase> = [
  {
    name: SORA_NAME,
    env: 'OPENAI_API_KEY',
    create: () =>
      createSoraAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
    response: JSON.stringify({
      id: 'sora-1',
      status: 'ok',
      output: { video_url: 'http://x' },
    }),
    input: {
      prompt: 'subject',
      aspect_ratio: '16:9',
      duration_sec: 10,
      format: 'short_video',
    },
    expected_provider: 'sora',
  },
  {
    name: SEEDANCE_NAME,
    env: 'SEEDANCE_API_KEY',
    create: () =>
      createSeedanceAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
    response: JSON.stringify({ task_id: 'sd-1', status: 'ok' }),
    input: {
      prompt: 'subject',
      aspect_ratio: '16:9',
      duration_sec: 8,
      format: 'short_video',
    },
    expected_provider: 'seedance',
  },
  {
    name: RECRAFT_NAME,
    env: 'RECRAFT_API_KEY',
    create: () =>
      createRecraftAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
    response: JSON.stringify({ data: [{ url: 'http://x' }] }),
    input: { prompt: 'subject', aspect_ratio: '1:1', format: 'image' },
    expected_provider: 'recraft',
  },
  {
    name: HEDRA_NAME,
    env: 'HEDRA_API_KEY',
    create: () =>
      createHedraAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
    response: JSON.stringify({ job_id: 'hd-1', status: 'ok' }),
    input: {
      prompt: 'tutorial',
      aspect_ratio: '9:16',
      duration_sec: 30,
      reference_audio_url: 'http://audio',
      reference_image_urls: ['http://portrait'],
      format: 'lipsync_video',
    },
    expected_provider: 'hedra',
  },
  {
    name: HEYGEN_NAME,
    env: 'HEYGEN_API_KEY',
    create: () =>
      createHeyGenAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
    response: JSON.stringify({ data: { video_id: 'hg-1', status: 'ok' } }),
    input: {
      prompt: 'avatar',
      aspect_ratio: '16:9',
      duration_sec: 60,
      reference_image_urls: ['avatar-id-borjie-1'],
      format: 'lipsync_video',
    },
    expected_provider: 'heygen',
  },
  {
    name: FIREFLY_NAME,
    env: 'FIREFLY_API_KEY',
    create: () =>
      createFireflyAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
    response: JSON.stringify({
      outputs: [{ image: { url: 'http://image' } }],
    }),
    input: { prompt: 'subject', aspect_ratio: '4:5', format: 'image' },
    expected_provider: 'firefly',
  },
  {
    name: SD35_NAME,
    env: 'SD35_API_KEY',
    create: () =>
      createSd35Adapter({ recipe: RECIPE_KEY, span_citations: [] }),
    response: JSON.stringify({ image: 'base64data', artifacts: [] }),
    input: { prompt: 'subject', aspect_ratio: '1:1', format: 'image' },
    expected_provider: 'sd35',
  },
];

const previousEnv = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in previousEnv)) delete process.env[k];
  }
});

describe('adapter shape coverage', () => {
  for (const c of CASES) {
    it(`${c.name} invokes + returns artifact`, async () => {
      process.env[c.env] = 'test-key';
      const adapter = c.create();
      const ctx = makeCtx(fetchOk(c.response));
      const result = await adapter.invoke(c.input, ctx);
      expect(result).not.toBeNull();
      if (!result) return;
      expect(result.provenance.model_provider).toBe(c.expected_provider);
      expect(result.audit_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(adapter.capabilities.length).toBeGreaterThan(0);
      expect(adapter.cost_per_unit_usd_cents).toBeGreaterThanOrEqual(0);
    });
  }

  it('every adapter exposes applyBrandLock that injects the prefix', () => {
    for (const c of CASES) {
      const a = c.create();
      const branded = a.applyBrandLock('Hello', BorjieBrandSpec);
      expect(branded).toContain('borjie OKLCH palette');
    }
  });

  it('every adapter has a unique provider id', () => {
    const ids = new Set(CASES.map((c) => c.create().provider_id));
    expect(ids.size).toBe(CASES.length);
  });
});
