/**
 * Caveat 5 — Live-test discipline.
 *
 * Closes the Wave 18N gap: production paths could accept recorded
 * fixtures masquerading as live provider responses. Mr. Mwikila's MD
 * persona refuses to publish a media artefact whose provenance
 * claims a real provider call when the adapter was a test mock.
 *
 * The guard inspects:
 *   - BORJIE_LIVE_MODE=strict env var. Set by the production
 *     bootstrap; absent in test environments.
 *   - Adapter metadata: `__is_live_adapter` set to false marks an
 *     adapter as non-live. Default = live (production-safe default).
 *
 * Persona: Mr. Mwikila (Managing Director).
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  applyLiveModeGuard,
  isLiveAdapter,
  isStrictLiveMode,
  markAdapterAsNonLive,
} from '../providers/live-mode-guard.js';
import { composeMedia } from '../composer.js';
import { buildBriefingThumbnailRecipe } from '../recipes/briefing-thumbnail.js';
import { MediaRecipeRegistry } from '../registry.js';
import { MediaCompositionError } from '../types.js';
import type {
  MediaArtifact,
  MediaComposeContext,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';

const previousEnv = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in previousEnv)) delete process.env[k];
  }
  if (previousEnv['BORJIE_LIVE_MODE'] === undefined) {
    delete process.env['BORJIE_LIVE_MODE'];
  } else {
    process.env['BORJIE_LIVE_MODE'] = previousEnv['BORJIE_LIVE_MODE'];
  }
});

function buildAdapter(provider_id: 'flux' | 'ideogram'): MediaProviderAdapter<
  MediaProviderInput,
  MediaArtifact
> {
  return {
    name: `fake-${provider_id}`,
    model_id: `${provider_id}-mock`,
    model_version: '0.0.1',
    provider_id,
    capabilities: ['text_to_image'],
    cost_per_unit_usd_cents: 1,
    applyBrandLock: (p) => p,
    invoke: async (input, ctx) => ({
      id: 'art-1',
      recipe_id: ctx.recipe_id,
      recipe_version: ctx.recipe_version,
      format: 'image',
      storage_key: 'borjie-media-x/art-1.png',
      thumb_storage_key: 'borjie-media-x/art-1.thumb.jpg',
      checksum: 'c'.repeat(64),
      provenance: {
        model_id: `${provider_id}-mock`,
        model_version: '0.0.1',
        model_provider: provider_id,
        prompt_text: input.prompt,
        prompt_image_refs: [],
        seed: ctx.seed ?? 'auto',
        safety_scan: {
          nsfw_probability: 0,
          deepfake_probability: 0,
          brand_violation_flags: [],
        },
        cost_usd_cents: 1,
        duration_ms: 1,
      },
      span_citations: [],
      audit_hash: 'd'.repeat(64),
      approval_state: 'auto_published',
      body: Buffer.from(`mock:${input.prompt}`, 'utf-8'),
      generated_at: '2026-05-26T00:00:00.000Z',
    }),
  };
}

function makeCtx(
  overrides: Partial<MediaComposeContext> = {},
): MediaComposeContext {
  return {
    tenant_id: 'tenant-tz-launch',
    intent_payload: {},
    available_data: [{ key: 'headline', value: 'Overnight FX moved 2%' }],
    research_result_id: null,
    owner_profile: {
      id: 'owner-1',
      displayName: 'Mr. Mwikila',
      preferred_language: 'en',
    },
    mastery_tier: 'veteran',
    target_audience: 'owner',
    language: 'en',
    citations: [
      {
        id: 'cit-1',
        claim: 'baseline',
        source: { kind: 'corpus_chunk', ref: 'c1' },
      },
    ],
    generated_at: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('Caveat 5 — live-mode detection', () => {
  it('default isLiveAdapter is true (production-safe)', () => {
    const a = buildAdapter('flux');
    expect(isLiveAdapter(a)).toBe(true);
  });

  it('markAdapterAsNonLive flips the marker', () => {
    const a = markAdapterAsNonLive(buildAdapter('flux'));
    expect(isLiveAdapter(a)).toBe(false);
  });

  it('marker is non-enumerable (does not leak into JSON / audit rows)', () => {
    const a = markAdapterAsNonLive(buildAdapter('flux'));
    expect(Object.keys(a)).not.toContain('__is_live_adapter');
    expect(JSON.stringify(a)).not.toContain('__is_live_adapter');
  });

  it('isStrictLiveMode reads BORJIE_LIVE_MODE env var', () => {
    delete process.env['BORJIE_LIVE_MODE'];
    expect(isStrictLiveMode()).toBe(false);
    process.env['BORJIE_LIVE_MODE'] = 'strict';
    expect(isStrictLiveMode()).toBe(true);
    process.env['BORJIE_LIVE_MODE'] = 'permissive';
    expect(isStrictLiveMode()).toBe(false);
    process.env['BORJIE_LIVE_MODE'] = '';
    expect(isStrictLiveMode()).toBe(false);
  });
});

describe('Caveat 5 — applyLiveModeGuard', () => {
  it('returns the ladder unchanged when not in strict mode', () => {
    delete process.env['BORJIE_LIVE_MODE'];
    const live = buildAdapter('flux');
    const nonLive = markAdapterAsNonLive(buildAdapter('ideogram'));
    const result = applyLiveModeGuard([live, nonLive]);
    expect(result).toEqual([live, nonLive]);
  });

  it('drops non-live adapters in strict mode', () => {
    process.env['BORJIE_LIVE_MODE'] = 'strict';
    const live = buildAdapter('flux');
    const nonLive = markAdapterAsNonLive(buildAdapter('ideogram'));
    const result = applyLiveModeGuard([live, nonLive]);
    expect(result.map((a) => a.provider_id)).toEqual(['flux']);
  });

  it('throws PROVIDER_NOT_AVAILABLE when no live adapters remain', () => {
    process.env['BORJIE_LIVE_MODE'] = 'strict';
    const nonLive1 = markAdapterAsNonLive(buildAdapter('flux'));
    const nonLive2 = markAdapterAsNonLive(buildAdapter('ideogram'));
    expect(() => applyLiveModeGuard([nonLive1, nonLive2])).toThrow(
      MediaCompositionError,
    );
    try {
      applyLiveModeGuard([nonLive1, nonLive2]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MediaCompositionError);
      const e = err as MediaCompositionError;
      expect(e.code).toBe('PROVIDER_NOT_AVAILABLE');
      expect(e.detail).toEqual(['flux', 'ideogram']);
    }
  });

  it('refuses an empty ladder explicitly when in strict mode', () => {
    process.env['BORJIE_LIVE_MODE'] = 'strict';
    expect(() => applyLiveModeGuard([])).toThrow(MediaCompositionError);
  });

  it('is a no-op for an empty ladder when not in strict mode', () => {
    delete process.env['BORJIE_LIVE_MODE'];
    expect(applyLiveModeGuard([])).toEqual([]);
  });
});

describe('Caveat 5 — composer refuses non-live ladder in strict mode', () => {
  it('strict mode + non-live adapter -> composer refuses', async () => {
    process.env['BORJIE_LIVE_MODE'] = 'strict';
    const nonLive = markAdapterAsNonLive(buildAdapter('flux'));
    const recipe = buildBriefingThumbnailRecipe({ adapters: [nonLive] });
    const registry = new MediaRecipeRegistry([recipe]);
    await expect(
      composeMedia({
        recipe_id: 'briefing_thumbnail',
        ctx: makeCtx(),
        registry,
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_AVAILABLE' });
  });

  it('strict mode + at least one live adapter -> composer proceeds with the live one', async () => {
    process.env['BORJIE_LIVE_MODE'] = 'strict';
    const nonLive = markAdapterAsNonLive(buildAdapter('flux'));
    const live = buildAdapter('ideogram');
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [nonLive, live],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: makeCtx(),
      registry,
    });
    expect(artifact.provenance.model_provider).toBe('ideogram');
  });

  it('non-strict mode (test default) -> composer proceeds with mocks unchanged', async () => {
    delete process.env['BORJIE_LIVE_MODE'];
    const nonLive = markAdapterAsNonLive(buildAdapter('flux'));
    const recipe = buildBriefingThumbnailRecipe({ adapters: [nonLive] });
    const registry = new MediaRecipeRegistry([recipe]);
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: makeCtx(),
      registry,
    });
    expect(artifact.provenance.model_provider).toBe('flux');
  });
});
