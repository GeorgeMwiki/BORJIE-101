/**
 * Caveat 3 — Per-tenant content rating gate.
 *
 * Closes the Wave 18N gap: the safety pipeline scanned for NSFW +
 * deepfake + brand violations but never applied a tenant-specific
 * ceiling. Mr. Mwikila's MD persona enforces strict SFW by default;
 * tenants that need relaxed ratings ship an explicit override and the
 * gate refuses publication when any safety probability exceeds the
 * tenant's ceiling.
 *
 * Persona: Mr. Mwikila (Managing Director).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_RATING_POLICY,
  RATING_NSFW_CEILING,
  applyContentRatingGate,
  createTenantRatingPolicyRegistry,
  getTenantRatingPolicy,
  mergeRatingPolicy,
  registerTenantRatingPolicy,
  setActiveTenantRatingPolicyRegistry,
  snapshotTenantRatingPolicyRegistry,
} from '../safety/content-rating-gate.js';
import type { TenantRatingPolicy } from '../safety/content-rating-gate.js';
import { composeMedia } from '../composer.js';
import { MediaCompositionError } from '../types.js';
import { buildBriefingThumbnailRecipe } from '../recipes/briefing-thumbnail.js';
import { MediaRecipeRegistry } from '../registry.js';
import type {
  MediaArtifact,
  MediaComposeContext,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';

let preservedRegistry: ReturnType<typeof snapshotTenantRatingPolicyRegistry>;
beforeEach(() => {
  preservedRegistry = snapshotTenantRatingPolicyRegistry();
});
afterEach(() => {
  setActiveTenantRatingPolicyRegistry(preservedRegistry);
});

function adapterWithNsfwScan(
  nsfw: number,
  deepfake = 0,
  flags: ReadonlyArray<string> = [],
): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return {
    name: 'fake-flux-with-nsfw',
    model_id: 'flux-mock',
    model_version: '0.0.1',
    provider_id: 'flux',
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
        model_id: 'flux-mock',
        model_version: '0.0.1',
        model_provider: 'flux',
        prompt_text: input.prompt,
        prompt_image_refs: [],
        seed: ctx.seed ?? 'auto',
        safety_scan: {
          nsfw_probability: nsfw,
          deepfake_probability: deepfake,
          brand_violation_flags: flags,
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

describe('Caveat 3 — content-rating gate evaluation', () => {
  it('default tenant policy is strict SFW with 0.2 NSFW ceiling', () => {
    expect(DEFAULT_TENANT_RATING_POLICY.max_rating).toBe('SFW');
    expect(DEFAULT_TENANT_RATING_POLICY.nsfw_ceiling).toBe(0.2);
    expect(DEFAULT_TENANT_RATING_POLICY.deepfake_ceiling).toBe(0.5);
  });

  it('approves a scan that sits below every ceiling', () => {
    const result = applyContentRatingGate({
      tenant_id: 'tenant-clean',
      safety_scan: {
        nsfw_probability: 0.1,
        deepfake_probability: 0.1,
        brand_violation_flags: [],
      },
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('refuses when NSFW probability exceeds the tenant ceiling', () => {
    const result = applyContentRatingGate({
      tenant_id: 'tenant-strict',
      safety_scan: {
        nsfw_probability: 0.5,
        deepfake_probability: 0,
        brand_violation_flags: [],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/^nsfw_above_ceiling:/);
  });

  it('refuses when deepfake probability exceeds the tenant ceiling', () => {
    const result = applyContentRatingGate({
      tenant_id: 'tenant-strict',
      safety_scan: {
        nsfw_probability: 0,
        deepfake_probability: 0.8,
        brand_violation_flags: [],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/^deepfake_above_ceiling:/);
  });

  it('refuses when a disallowed brand-violation flag is set', () => {
    const policy_override: TenantRatingPolicy = {
      max_rating: 'SFW',
      nsfw_ceiling: 0.2,
      deepfake_ceiling: 0.5,
      disallowed_brand_violation_flags: Object.freeze(['fake_logo']),
    };
    const result = applyContentRatingGate({
      tenant_id: 'tenant-strict',
      safety_scan: {
        nsfw_probability: 0,
        deepfake_probability: 0,
        brand_violation_flags: ['fake_logo'],
      },
      policy_override,
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain('disallowed_brand_flag:fake_logo');
  });

  it('honours an explicit policy_override over the registered tenant policy', () => {
    registerTenantRatingPolicy('tenant-r-rated', { max_rating: 'R' });
    const result = applyContentRatingGate({
      tenant_id: 'tenant-r-rated',
      safety_scan: {
        nsfw_probability: 0.5,
        deepfake_probability: 0,
        brand_violation_flags: [],
      },
      // explicit policy_override is strict SFW even though tenant is R
      policy_override: DEFAULT_TENANT_RATING_POLICY,
    });
    expect(result.ok).toBe(false);
  });
});

describe('Caveat 3 — registry semantics', () => {
  it('createTenantRatingPolicyRegistry uses the supplied fallback', () => {
    const r = createTenantRatingPolicyRegistry({
      max_rating: 'PG',
      nsfw_ceiling: 0.3,
      deepfake_ceiling: 0.5,
      disallowed_brand_violation_flags: [],
    });
    expect(r.get('unknown').max_rating).toBe('PG');
    expect(r.list()).toEqual([]);
  });

  it('register attaches a tenant policy and returns a new registry', () => {
    const r0 = createTenantRatingPolicyRegistry();
    const r1 = r0.register('tenant-bn', { max_rating: 'R' });
    expect(r0.get('tenant-bn').max_rating).toBe('SFW');
    expect(r1.get('tenant-bn').max_rating).toBe('R');
    expect(r1.get('tenant-bn').nsfw_ceiling).toBe(RATING_NSFW_CEILING.R);
    expect(r1.list()).toHaveLength(1);
  });

  it('registerTenantRatingPolicy updates the active singleton', () => {
    expect(getTenantRatingPolicy('tenant-x').max_rating).toBe('SFW');
    registerTenantRatingPolicy('tenant-x', { max_rating: 'PG-13' });
    expect(getTenantRatingPolicy('tenant-x').max_rating).toBe('PG-13');
    expect(getTenantRatingPolicy('tenant-x').nsfw_ceiling).toBe(
      RATING_NSFW_CEILING['PG-13'],
    );
    expect(getTenantRatingPolicy('tenant-y').max_rating).toBe('SFW');
  });

  it('registerTenantRatingPolicy refuses empty tenant ids', () => {
    expect(() => registerTenantRatingPolicy('', { max_rating: 'PG' })).toThrow(
      /tenantId must be non-empty/,
    );
  });

  it('mergeRatingPolicy back-derives nsfw_ceiling from max_rating when not supplied', () => {
    const merged = mergeRatingPolicy(DEFAULT_TENANT_RATING_POLICY, {
      max_rating: 'R',
    });
    expect(merged.max_rating).toBe('R');
    expect(merged.nsfw_ceiling).toBe(RATING_NSFW_CEILING.R);
  });

  it('mergeRatingPolicy preserves explicit nsfw_ceiling override', () => {
    const merged = mergeRatingPolicy(DEFAULT_TENANT_RATING_POLICY, {
      max_rating: 'R',
      nsfw_ceiling: 0.4,
    });
    expect(merged.nsfw_ceiling).toBe(0.4);
  });

  it('snapshot + restore round-trip', () => {
    const before = snapshotTenantRatingPolicyRegistry();
    registerTenantRatingPolicy('tenant-temp', { max_rating: 'R' });
    expect(getTenantRatingPolicy('tenant-temp').max_rating).toBe('R');
    setActiveTenantRatingPolicyRegistry(before);
    expect(getTenantRatingPolicy('tenant-temp').max_rating).toBe('SFW');
  });
});

describe('Caveat 3 — composer refuses when gate fails', () => {
  it('refuses with SAFETY_REFUSED when NSFW exceeds the tenant ceiling', async () => {
    // Default tenant policy: SFW, nsfw_ceiling=0.2. Adapter emits 0.9.
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [adapterWithNsfwScan(0.9)],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    await expect(
      composeMedia({
        recipe_id: 'briefing_thumbnail',
        ctx: makeCtx(),
        registry,
      }),
    ).rejects.toBeInstanceOf(MediaCompositionError);
  });

  it('passes when the tenant opted into a relaxed rating', async () => {
    registerTenantRatingPolicy('tenant-tz-launch', { max_rating: 'R' });
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [adapterWithNsfwScan(0.5)], // would fail SFW, ok under R
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: makeCtx(),
      registry,
    });
    expect(artifact.format).toBe('image');
  });

  it('refusal carries the violation list in the error detail', async () => {
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [adapterWithNsfwScan(0.9, 0.95)],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    try {
      await composeMedia({
        recipe_id: 'briefing_thumbnail',
        ctx: makeCtx(),
        registry,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MediaCompositionError);
      const e = err as MediaCompositionError;
      expect(e.code).toBe('SAFETY_REFUSED');
      expect(e.detail.length).toBeGreaterThan(0);
      expect(e.detail.some((d) => d.startsWith('nsfw_above_ceiling:'))).toBe(true);
      expect(e.detail.some((d) => d.startsWith('deepfake_above_ceiling:'))).toBe(true);
    }
  });
});
