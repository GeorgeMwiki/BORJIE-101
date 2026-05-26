/**
 * Provider adapter + factory + dispatcher tests.
 *
 * Mocks the HTTP layer via `fetchImpl` injection. Asserts:
 *   - missing env keys → adapter returns null
 *   - cost-budget reserved before fetch, released on failure
 *   - dispatcher walks adapters in capability order
 *   - artifact assembly stamps checksum + audit hash
 */

import { describe, expect, it } from 'vitest';
import type {
  MediaArtifact,
  MediaProviderAdapter,
  MediaProviderInput,
  ProviderContext,
} from '../types.js';
import { createCostTracker } from '../budgets/cost-tracker.js';
import { BorjieBrandSpec } from '../brand-lock/brand-spec.js';
import { createFluxAdapter } from '../providers/flux-adapter.js';
import { createRunwayAdapter } from '../providers/runway-adapter.js';
import { createSoraAdapter } from '../providers/sora-adapter.js';
import { createSeedanceAdapter } from '../providers/seedance-adapter.js';
import { createIdeogramAdapter } from '../providers/ideogram-adapter.js';
import { createRecraftAdapter } from '../providers/recraft-adapter.js';
import { createImagenAdapter } from '../providers/imagen-adapter.js';
import { createHedraAdapter } from '../providers/hedra-adapter.js';
import { createHeyGenAdapter } from '../providers/heygen-adapter.js';
import { createFireflyAdapter } from '../providers/firefly-adapter.js';
import { createSd35Adapter } from '../providers/sd35-adapter.js';
import {
  FALLBACK_BY_CAPABILITY,
  dispatchToProvider,
  reorderForCapability,
} from '../providers/dispatcher.js';

const RECIPE_KEY = {
  id: 'briefing_thumbnail',
  version: 1,
  class: 'briefing_thumbnail' as const,
  authority_tier: 0 as const,
  approval_required: false,
};

function makeCtx(overrides: { fetchImpl?: typeof fetch } = {}): ProviderContext {
  const tracker = createCostTracker({ budget_usd_cents: 100 });
  return {
    tenant_id: 't1',
    recipe_id: RECIPE_KEY.id,
    recipe_version: RECIPE_KEY.version,
    brand_spec: BorjieBrandSpec,
    cost_tracker: tracker,
    ...(overrides.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
    seed: 'seed-1',
  };
}

const TEXT_INPUT: MediaProviderInput = {
  prompt: 'Hero thumbnail of overnight events',
  aspect_ratio: '1:1',
  format: 'image',
};

const fetchOk = (body: string): typeof fetch =>
  (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

const fetchFail = (): typeof fetch =>
  (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

describe('graceful degradation (no env key)', () => {
  const previousEnv = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in previousEnv)) delete process.env[k];
    }
  });

  it('flux adapter returns null without FLUX_API_KEY', async () => {
    delete process.env.FLUX_API_KEY;
    const adapter = createFluxAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const result = await adapter.invoke(TEXT_INPUT, makeCtx());
    expect(result).toBeNull();
  });

  it('runway adapter returns null without RUNWAY_API_KEY', async () => {
    delete process.env.RUNWAY_API_KEY;
    const adapter = createRunwayAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const result = await adapter.invoke(
      { ...TEXT_INPUT, format: 'short_video', duration_sec: 6 },
      makeCtx(),
    );
    expect(result).toBeNull();
  });

  it('all 11 adapters return null without env keys', async () => {
    const adapters: ReadonlyArray<
      MediaProviderAdapter<MediaProviderInput, MediaArtifact>
    > = [
      createRunwayAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createSoraAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createSeedanceAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createFluxAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createIdeogramAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createRecraftAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createImagenAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createHedraAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createHeyGenAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createFireflyAdapter({ recipe: RECIPE_KEY, span_citations: [] }),
      createSd35Adapter({ recipe: RECIPE_KEY, span_citations: [] }),
    ];
    delete process.env.RUNWAY_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SEEDANCE_API_KEY;
    delete process.env.FLUX_API_KEY;
    delete process.env.IDEOGRAM_API_KEY;
    delete process.env.RECRAFT_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.HEDRA_API_KEY;
    delete process.env.HEYGEN_API_KEY;
    delete process.env.FIREFLY_API_KEY;
    delete process.env.SD35_API_KEY;
    for (const a of adapters) {
      const r = await a.invoke(
        a.capabilities.includes('text_to_image')
          ? TEXT_INPUT
          : {
              ...TEXT_INPUT,
              format:
                a.capabilities.includes('lipsync_video')
                  ? 'lipsync_video'
                  : 'short_video',
              duration_sec: 6,
            },
        makeCtx(),
      );
      expect(r).toBeNull();
    }
    expect(adapters.length).toBe(11);
  });
});

describe('successful adapter invocation', () => {
  const previousEnv = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in previousEnv)) delete process.env[k];
    }
  });

  it('flux adapter assembles an artifact when API succeeds', async () => {
    process.env.FLUX_API_KEY = 'sk-test';
    const adapter = createFluxAdapter({
      recipe: RECIPE_KEY,
      span_citations: [
        {
          id: 'cit-1',
          claim: 'baseline',
          source: { kind: 'corpus_chunk', ref: 'c1' },
        },
      ],
    });
    const ctx = makeCtx({
      fetchImpl: fetchOk(
        JSON.stringify({ id: 'flux-job-1', result: { sample: 'data' } }),
      ),
    });
    const result = await adapter.invoke(TEXT_INPUT, ctx);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.format).toBe('image');
    expect(result.provenance.model_provider).toBe('flux');
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.audit_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.provenance.prompt_text).toContain('borjie OKLCH palette');
    expect(result.span_citations.length).toBe(1);
  });

  it('runway adapter assembles a video artifact', async () => {
    process.env.RUNWAY_API_KEY = 'rw-test';
    const adapter = createRunwayAdapter({
      recipe: {
        id: 'investor_brand_video',
        version: 1,
        class: 'investor_brand_video',
        authority_tier: 2,
        approval_required: true,
      },
      span_citations: [],
    });
    const ctx = makeCtx({
      fetchImpl: fetchOk(
        JSON.stringify({ id: 'rw-1', status: 'completed', video: { url: 'http://x' } }),
      ),
    });
    const result = await adapter.invoke(
      { ...TEXT_INPUT, format: 'short_video', duration_sec: 6, aspect_ratio: '16:9' },
      ctx,
    );
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.format).toBe('short_video');
    expect(result.provenance.model_provider).toBe('runway');
  });

  it('releases the budget on HTTP failure', async () => {
    process.env.FLUX_API_KEY = 'sk-test';
    const tracker = createCostTracker({ budget_usd_cents: 100 });
    const adapter = createFluxAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const ctx: ProviderContext = {
      tenant_id: 't1',
      recipe_id: RECIPE_KEY.id,
      recipe_version: RECIPE_KEY.version,
      brand_spec: BorjieBrandSpec,
      cost_tracker: tracker,
      fetchImpl: fetchFail(),
    };
    const result = await adapter.invoke(TEXT_INPUT, ctx);
    expect(result).toBeNull();
    expect(await tracker.spent()).toBe(0);
    // reservation released → full budget available
    expect(await tracker.tryReserve(100)).toBe(true);
  });

  it('refuses when budget exceeded', async () => {
    process.env.FLUX_API_KEY = 'sk-test';
    const tracker = createCostTracker({ budget_usd_cents: 1 });
    const adapter = createFluxAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const ctx: ProviderContext = {
      tenant_id: 't1',
      recipe_id: RECIPE_KEY.id,
      recipe_version: RECIPE_KEY.version,
      brand_spec: BorjieBrandSpec,
      cost_tracker: tracker,
      fetchImpl: fetchOk(JSON.stringify({ id: 'x' })),
    };
    const result = await adapter.invoke(TEXT_INPUT, ctx);
    expect(result).toBeNull();
  });
});

describe('dispatcher', () => {
  const previousEnv = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in previousEnv)) delete process.env[k];
    }
  });

  it('reorders adapters to match canonical fallback order', () => {
    const flux = createFluxAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const imagen = createImagenAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const ordered = reorderForCapability('text_to_image', [imagen, flux]);
    expect(ordered.map((a) => a.provider_id)).toEqual(['flux', 'imagen']);
  });

  it('falls through to the next adapter when the first returns null', async () => {
    delete process.env.FLUX_API_KEY;
    process.env.IDEOGRAM_API_KEY = 'id-test';
    const flux = createFluxAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const ideogram = createIdeogramAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const ctx = makeCtx({
      fetchImpl: fetchOk(
        JSON.stringify({ data: [{ url: 'http://image' }] }),
      ),
    });
    const result = await dispatchToProvider({
      capability: 'text_to_image',
      input: TEXT_INPUT,
      ctx,
      adapters: [flux, ideogram],
    });
    expect(result.artifact.provenance.model_provider).toBe('ideogram');
    expect(result.fallback_path).toEqual(['flux', 'ideogram']);
  });

  it('throws when every adapter returns null', async () => {
    delete process.env.FLUX_API_KEY;
    delete process.env.IDEOGRAM_API_KEY;
    const flux = createFluxAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const ideogram = createIdeogramAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    await expect(
      dispatchToProvider({
        capability: 'text_to_image',
        input: TEXT_INPUT,
        ctx: makeCtx(),
        adapters: [flux, ideogram],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_AVAILABLE' });
  });

  it('canonical fallback path covers every capability', () => {
    for (const cap of [
      'text_to_image',
      'image_to_image',
      'text_to_video',
      'image_to_video',
      'lipsync_video',
      'inpainting',
    ] as const) {
      expect(FALLBACK_BY_CAPABILITY[cap].length).toBeGreaterThan(0);
    }
  });

  it('records the provider tried even on adapter throw', async () => {
    delete process.env.FLUX_API_KEY;
    process.env.IDEOGRAM_API_KEY = 'id-test';
    const throwing: MediaProviderAdapter<MediaProviderInput, MediaArtifact> = {
      name: 'mock-throw',
      model_id: 'mock',
      model_version: 'x',
      provider_id: 'flux',
      capabilities: ['text_to_image'],
      cost_per_unit_usd_cents: 5,
      applyBrandLock: (p) => p,
      invoke: async () => {
        throw new Error('mock-down');
      },
    };
    const ideogram = createIdeogramAdapter({
      recipe: RECIPE_KEY,
      span_citations: [],
    });
    const ctx = makeCtx({
      fetchImpl: fetchOk(
        JSON.stringify({ data: [{ url: 'http://image' }] }),
      ),
    });
    const result = await dispatchToProvider({
      capability: 'text_to_image',
      input: TEXT_INPUT,
      ctx,
      adapters: [throwing, ideogram],
    });
    expect(result.fallback_path).toEqual(['flux', 'ideogram']);
  });
});
