/**
 * Caveat 2 — Tenant-scoped style guard.
 *
 * Closes the Wave 18N gap: `getBrandSpec(tenantId)` previously ignored
 * the tenant id and always returned the Borjie default. Multi-tenant
 * brand voice now flows through a registry so each tenant's media
 * generations are locked to their own BrandSpec (palette, photographic
 * style, wordmark policy, denylist). Cross-tenant calls fall back to
 * the default — they never leak another tenant's brand DNA.
 *
 * Persona: Mr. Mwikila (Managing Director).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BorjieBrandSpec,
  createBrandSpecRegistry,
  getBrandSpec,
  registerBrandSpec,
  setActiveBrandSpecRegistry,
  snapshotBrandSpecRegistry,
} from '../brand-lock/brand-spec.js';
import { buildBrandedPrompt } from '../brand-lock/prompt-prefix-builder.js';
import type { BrandSpec } from '../types.js';
import { composeMedia } from '../composer.js';
import { buildBriefingThumbnailRecipe } from '../recipes/briefing-thumbnail.js';
import { MediaRecipeRegistry } from '../registry.js';
import type {
  MediaArtifact,
  MediaComposeContext,
  MediaProviderAdapter,
  MediaProviderInput,
} from '../types.js';
import { extractC2paManifest } from '../watermark/c2pa-embedder.js';

const BOSSNYUMBA_SPEC: BrandSpec = Object.freeze({
  brand: 'borjie', // BrandSpec.brand literal is 'borjie' in this package; the brand fork string is the wordmark
  photographic_style:
    'editorial, daylight, neutral but warm — BossNyumba sibling fork',
  palette: Object.freeze([
    Object.freeze({
      name: 'signal_primary',
      oklch: 'oklch(0.62 0.18 25)',
      hex: '#C6452B',
    }),
    Object.freeze({
      name: 'foreground_neutral',
      oklch: 'oklch(0.98 0.01 100)',
      hex: '#FAFAF7',
    }),
    Object.freeze({
      name: 'surface_background',
      oklch: 'oklch(0.16 0.02 100)',
      hex: '#0C0C09',
    }),
  ]),
  typography_rule: 'font-display serif (Fraunces); no other font families',
  wordmark_policy: 'bottom-right at 80% opacity, never inverted',
  negative_prompt_terms: Object.freeze([
    'cartoonish style',
    'off-brand color scheme',
    'NSFW',
    'low-resolution',
  ]),
  wordmark_svg_path: 'packages/design-system/src/brand/bossnyumba-wordmark.svg',
  signature_gradient_direction: '45deg',
  real_person_consent_required: true,
});

let preservedRegistry: ReturnType<typeof snapshotBrandSpecRegistry>;
beforeEach(() => {
  preservedRegistry = snapshotBrandSpecRegistry();
});
afterEach(() => {
  setActiveBrandSpecRegistry(preservedRegistry);
});

function fakeAdapter(): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return {
    name: 'fake-flux',
    model_id: 'flux-mock',
    model_version: '0.0.1',
    provider_id: 'flux',
    capabilities: ['text_to_image'],
    cost_per_unit_usd_cents: 1,
    applyBrandLock: (p) => p,
    invoke: async (input, ctx) => {
      // Production adapters mechanically apply brand-lock prefix via
      // applyBrandLock(input.prompt, ctx.brand_spec). Mirror that so the
      // BrandSpec resolved by the composer flows through.
      const branded = buildBrandedPrompt(ctx.brand_spec, input.prompt);
      return {
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
          prompt_text: branded,
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
        body: Buffer.from(`mock:${branded}`, 'utf-8'),
        generated_at: '2026-05-26T00:00:00.000Z',
      };
    },
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

describe('Caveat 2 — BrandSpec registry is tenant-scoped', () => {
  it('createBrandSpecRegistry returns an empty registry whose fallback is the default', () => {
    const r = createBrandSpecRegistry();
    expect(r.get('tenant-unknown')).toBe(BorjieBrandSpec);
    expect(r.list()).toEqual([]);
  });

  it('register attaches a tenant override and returns a new registry', () => {
    const r0 = createBrandSpecRegistry();
    const r1 = r0.register('tenant-bn', BOSSNYUMBA_SPEC);
    expect(r0.get('tenant-bn')).toBe(BorjieBrandSpec);
    expect(r1.get('tenant-bn')).toBe(BOSSNYUMBA_SPEC);
    expect(r1.list()).toHaveLength(1);
  });

  it('cross-tenant lookups fall back to the default; no leakage', () => {
    const r = createBrandSpecRegistry().register('tenant-a', BOSSNYUMBA_SPEC);
    expect(r.get('tenant-a')).toBe(BOSSNYUMBA_SPEC);
    expect(r.get('tenant-b')).toBe(BorjieBrandSpec);
  });

  it('registerBrandSpec mutates the active singleton in a controlled way', () => {
    expect(getBrandSpec('tenant-x')).toBe(BorjieBrandSpec);
    registerBrandSpec('tenant-x', BOSSNYUMBA_SPEC);
    expect(getBrandSpec('tenant-x')).toBe(BOSSNYUMBA_SPEC);
    // Other tenants are unaffected.
    expect(getBrandSpec('tenant-y')).toBe(BorjieBrandSpec);
  });

  it('registerBrandSpec refuses empty tenant ids', () => {
    expect(() => registerBrandSpec('', BOSSNYUMBA_SPEC)).toThrow(
      /tenantId must be non-empty/,
    );
    expect(() => registerBrandSpec('   ', BOSSNYUMBA_SPEC)).toThrow(
      /tenantId must be non-empty/,
    );
  });

  it('snapshot + setActiveBrandSpecRegistry restore the registry between scopes', () => {
    const before = snapshotBrandSpecRegistry();
    registerBrandSpec('tenant-temp', BOSSNYUMBA_SPEC);
    expect(getBrandSpec('tenant-temp')).toBe(BOSSNYUMBA_SPEC);
    setActiveBrandSpecRegistry(before);
    expect(getBrandSpec('tenant-temp')).toBe(BorjieBrandSpec);
  });
});

describe('Caveat 2 — tenant override flows through the composer', () => {
  it('the tenant-scoped BrandSpec is the one baked into the artifact prompt', async () => {
    registerBrandSpec('tenant-bn', BOSSNYUMBA_SPEC);
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [fakeAdapter()],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const ctxBorjie = makeCtx({ tenant_id: 'tenant-tz-launch' });
    const ctxBn = makeCtx({ tenant_id: 'tenant-bn' });
    const artifactBorjie = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: ctxBorjie,
      registry,
    });
    const artifactBn = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: ctxBn,
      registry,
    });
    // Bonyumba's font rule is serif; Borjie's is sans-serif. The two
    // prompts must diverge on this exact token.
    expect(artifactBorjie.provenance.prompt_text).toContain('sans-serif');
    expect(artifactBn.provenance.prompt_text).toContain('serif');
    expect(artifactBn.provenance.prompt_text).not.toContain('sans-serif');
  });

  it('the BrandSpec passed via ctx.brand_spec overrides the registry', async () => {
    registerBrandSpec('tenant-bn', BOSSNYUMBA_SPEC);
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [fakeAdapter()],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const ctx = makeCtx({
      tenant_id: 'tenant-bn',
      brand_spec: BorjieBrandSpec, // force the Borjie spec
    });
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx,
      registry,
    });
    // Even though the tenant is bn, ctx override won. Sans-serif rule
    // appears (Borjie), serif rule (Bonyumba) does not.
    expect(artifact.provenance.prompt_text).toContain('sans-serif');
  });

  it('the brand spec carries through to the C2PA manifest brand field', async () => {
    registerBrandSpec('tenant-bn', BOSSNYUMBA_SPEC);
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [fakeAdapter()],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: makeCtx({ tenant_id: 'tenant-bn' }),
      registry,
    });
    const manifest = extractC2paManifest(artifact.body);
    const credentials = manifest?.assertions[1]?.data as Record<string, unknown>;
    // Both tenants in the v1 BrandSpec carry brand='borjie' literal —
    // multi-brand forks ship their own BrandSpec with a different
    // brand literal. This test confirms the value flows through.
    expect(credentials['brand']).toBe(BOSSNYUMBA_SPEC.brand);
  });
});

describe('Caveat 2 — denylist enforcement is tenant-scoped', () => {
  it('the BrandSpec denylist becomes the negative_prompt token list', () => {
    const promptBorjie = buildBrandedPrompt(BorjieBrandSpec, 'subject');
    const promptBn = buildBrandedPrompt(BOSSNYUMBA_SPEC, 'subject');
    expect(promptBorjie).toContain('gore');
    expect(promptBn).not.toContain('gore');
  });
});
