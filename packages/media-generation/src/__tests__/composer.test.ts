/**
 * Composer dispatcher tests — recipe resolution, missing recipe
 * refusal, consent gate, input-gap refusal, end-to-end seed recipe
 * smoke (fetch mocked).
 */

import { describe, expect, it } from 'vitest';
import { composeMedia } from '../composer.js';
import { MediaCompositionError } from '../types.js';
import type {
  MediaArtifact,
  MediaComposeContext,
  MediaProviderAdapter,
  MediaProviderInput,
  MediaRecipe,
} from '../types.js';
import { buildBriefingThumbnailRecipe } from '../recipes/briefing-thumbnail.js';
import { buildMarketplaceListingHeroRecipe } from '../recipes/marketplace-listing-hero.js';
import { buildSocialPostStillRecipe } from '../recipes/social-post-still.js';
import { MediaRecipeRegistry } from '../registry.js';

function fakeImageAdapter(
  provider_id: 'flux' | 'ideogram' | 'imagen' | 'recraft',
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return {
    name: `fake-${provider_id}`,
    model_id: `${provider_id}-mock`,
    model_version: '0.0.1',
    provider_id,
    capabilities: ['text_to_image'],
    cost_per_unit_usd_cents: 1,
    applyBrandLock: (p) => p,
    invoke: async (input, ctx) => {
      const bytes = Buffer.from(
        `mock:${provider_id}:${input.prompt}:${ctx.seed ?? 'auto'}`,
        'utf-8',
      );
      // Synthesise a minimal artifact — the composer's safety pipeline
      // re-seals the audit hash anyway.
      return {
        id: 'art-1',
        recipe_id: ctx.recipe_id,
        recipe_version: ctx.recipe_version,
        format: 'image',
        storage_key: `borjie-media-x/${ctx.recipe_id}.png`,
        thumb_storage_key: `borjie-media-x/${ctx.recipe_id}.thumb.jpg`,
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
        body: bytes,
        generated_at: '2026-05-26T00:00:00.000Z',
      };
    },
  };
}

function makeCtx(overrides: Partial<MediaComposeContext> = {}): MediaComposeContext {
  const base: MediaComposeContext = {
    tenant_id: 'tenant-test',
    intent_payload: {},
    available_data: [],
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
  };
  return { ...base, ...overrides };
}

describe('composeMedia dispatcher', () => {
  it('refuses with RECIPE_NOT_FOUND for unknown ids', async () => {
    await expect(
      composeMedia({ recipe_id: 'nonexistent', ctx: makeCtx() }),
    ).rejects.toBeInstanceOf(MediaCompositionError);
  });

  it('refuses with RECIPE_NOT_FOUND for unknown version', async () => {
    await expect(
      composeMedia({
        recipe_id: 'briefing_thumbnail',
        recipe_version: 99,
        ctx: makeCtx(),
      }),
    ).rejects.toMatchObject({ code: 'RECIPE_NOT_FOUND' });
  });
});

describe('seed recipes — end-to-end smoke', () => {
  it('briefing_thumbnail composes via injected adapters', async () => {
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [fakeImageAdapter('flux')],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const ctx = makeCtx({
      available_data: [{ key: 'headline', value: 'FX moved 2% overnight' }],
    });
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx,
      registry,
    });
    expect(artifact.format).toBe('image');
    expect(artifact.provenance.model_provider).toBe('flux');
    expect(artifact.audit_hash).toMatch(/^[0-9a-f]{64}$/);
    // C2PA sidecar embedded — extract back.
    expect(artifact.body.toString('utf-8')).toContain('C2PA-MANIFEST');
  });

  it('briefing_thumbnail is Tier-0 → auto_published initial state', async () => {
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [fakeImageAdapter('flux')],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const ctx = makeCtx({
      available_data: [{ key: 'headline', value: 'X' }],
    });
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx,
      registry,
    });
    expect(artifact.approval_state).toBe('auto_published');
  });

  it('marketplace_listing_hero refuses with INPUT_GAP when parcel missing', async () => {
    const recipe = buildMarketplaceListingHeroRecipe({
      adapters: [fakeImageAdapter('flux')],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    await expect(
      composeMedia({
        recipe_id: 'marketplace_listing_hero',
        ctx: makeCtx(),
        registry,
      }),
    ).rejects.toMatchObject({ code: 'INPUT_GAP' });
  });

  it('marketplace_listing_hero composes with valid parcel data', async () => {
    const recipe = buildMarketplaceListingHeroRecipe({
      adapters: [fakeImageAdapter('flux'), fakeImageAdapter('ideogram')],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const ctx = makeCtx({
      available_data: [
        {
          key: 'parcel',
          value: {
            parcel_id: 'PRL-001',
            grade_g_per_t: 18.7,
            tonnage_t: 12.5,
            region: 'Geita',
            mineral: 'gold',
          },
        },
      ],
    });
    const artifact = await composeMedia({
      recipe_id: 'marketplace_listing_hero',
      ctx,
      registry,
    });
    expect(artifact.format).toBe('image');
    expect(artifact.provenance.prompt_text).toContain('PRL-001');
    expect(artifact.provenance.prompt_text).toContain('Geita');
  });

  it('social_post_still composes with valid payload', async () => {
    const recipe = buildSocialPostStillRecipe({
      adapters: [fakeImageAdapter('flux')],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const ctx = makeCtx({
      available_data: [
        {
          key: 'campaign_payload',
          value: {
            theme: 'Q3 production milestone',
            call_to_action: 'Read full update',
          },
        },
      ],
    });
    const artifact = await composeMedia({
      recipe_id: 'social_post_still',
      ctx,
      registry,
    });
    expect(artifact.format).toBe('image');
    expect(artifact.provenance.prompt_text).toContain('Q3 production milestone');
  });

  it('audit hash differs across recipes', async () => {
    const briefing = buildBriefingThumbnailRecipe({
      adapters: [fakeImageAdapter('flux')],
    });
    const social = buildSocialPostStillRecipe({
      adapters: [fakeImageAdapter('flux')],
    });
    const registry = new MediaRecipeRegistry([briefing, social]);
    const a = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: makeCtx({
        available_data: [{ key: 'headline', value: 'h' }],
      }),
      registry,
    });
    const b = await composeMedia({
      recipe_id: 'social_post_still',
      ctx: makeCtx({
        available_data: [
          {
            key: 'campaign_payload',
            value: { theme: 't', call_to_action: 'c' },
          },
        ],
      }),
      registry,
    });
    expect(a.audit_hash).not.toBe(b.audit_hash);
  });
});

describe('consent enforcement', () => {
  it('tutorial_lipsync_video class requires consent_token', async () => {
    // Construct a synthetic recipe in the tutorial_lipsync class —
    // we don't ship a seed recipe but the helper enforces the gate.
    const recipe: MediaRecipe = {
      id: 'tutorial_smoke',
      class: 'tutorial_lipsync_video',
      version: 1,
      status: 'live',
      authority_tier: 1,
      brand: 'borjie',
      approval_required: true,
      output_format: 'lipsync_video',
      target_aspect_ratio: '9:16',
      target_duration_sec: 30,
      required_prompt_inputs: [],
      compose: async (ctx) => {
        const { runRecipe } = await import('../recipes/_helpers.js');
        return runRecipe({
          recipe,
          ctx,
          capability: 'lipsync_video',
          subject_prompt: 'Tutorial scene',
          adapters: [],
          expect_wordmark: false,
        });
      },
    };
    const registry = new MediaRecipeRegistry([recipe]);
    await expect(
      composeMedia({ recipe_id: 'tutorial_smoke', ctx: makeCtx(), registry }),
    ).rejects.toMatchObject({ code: 'CONSENT_MISSING' });
  });
});
