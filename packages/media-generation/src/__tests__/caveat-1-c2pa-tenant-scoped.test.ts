/**
 * Caveat 1 — Watermarking + provenance (C2PA standard).
 *
 * Closes the Wave 18N gap: the C2PA manifest must be tenant-scoped so
 * regulators can verify the artifact was produced for a specific
 * tenant, and the visible-watermark plan must be wired into the
 * composer pipeline (not detached) so Tier-1/2 public-facing variants
 * can render the wordmark without re-fetching the BrandSpec.
 *
 * Persona: Mr. Mwikila (Managing Director).
 */

import { describe, expect, it } from 'vitest';
import {
  buildC2paManifest,
  embedC2paManifest,
  extractC2paManifest,
} from '../watermark/c2pa-embedder.js';
import { composeMedia } from '../composer.js';
import { buildBriefingThumbnailRecipe } from '../recipes/briefing-thumbnail.js';
import { MediaRecipeRegistry } from '../registry.js';
import { readVisibleWatermarkPlan } from '../recipes/_helpers.js';
import type {
  MediaArtifact,
  MediaComposeContext,
  MediaProviderAdapter,
  MediaProviderInput,
  MediaProvenance,
} from '../types.js';

const PROVENANCE: MediaProvenance = {
  model_id: 'flux',
  model_version: '1.1.0',
  model_provider: 'flux',
  prompt_text: 'Photographic style: borjie OKLCH palette',
  prompt_image_refs: [],
  seed: 'seed-1',
  safety_scan: {
    nsfw_probability: 0,
    deepfake_probability: 0,
    brand_violation_flags: [],
  },
  cost_usd_cents: 6,
  duration_ms: 1_000,
};

const MANIFEST_BASE = {
  recipe_id: 'briefing_thumbnail',
  recipe_version: 1,
  audit_hash: 'a'.repeat(64),
  checksum: 'b'.repeat(64),
  provenance: PROVENANCE,
  generated_at: '2026-05-26T00:00:00.000Z',
} as const;

function fakeAdapter(): MediaProviderAdapter<MediaProviderInput, MediaArtifact> {
  return {
    name: 'fake-flux',
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
        ...PROVENANCE,
        prompt_text: input.prompt,
        seed: ctx.seed ?? 'auto',
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

describe('Caveat 1 — C2PA manifest is tenant-scoped', () => {
  it('embeds tenant_id into the c2pa.actions assertion parameters', () => {
    const m = buildC2paManifest({
      ...MANIFEST_BASE,
      tenant_id: 'tenant-borjie-tz',
    });
    const actions = m.assertions[0]?.data['actions'] as ReadonlyArray<{
      readonly parameters: Record<string, unknown>;
    }>;
    expect(actions[0]?.parameters['tenant_id']).toBe('tenant-borjie-tz');
  });

  it('embeds tenant_id + brand into the brand_credentials assertion', () => {
    const m = buildC2paManifest({
      ...MANIFEST_BASE,
      tenant_id: 'tenant-bossnyumba-ke',
      brand: 'bossnyumba',
    });
    const credentials = m.assertions[1]?.data as Record<string, unknown>;
    expect(credentials['tenant_id']).toBe('tenant-bossnyumba-ke');
    expect(credentials['brand']).toBe('bossnyumba');
  });

  it('produces a distinct signature per tenant', () => {
    const a = buildC2paManifest({ ...MANIFEST_BASE, tenant_id: 'tenant-a' });
    const b = buildC2paManifest({ ...MANIFEST_BASE, tenant_id: 'tenant-b' });
    expect(a.signature.value).not.toBe(b.signature.value);
  });

  it('produces a distinct signature per brand fork', () => {
    const a = buildC2paManifest({ ...MANIFEST_BASE, brand: 'borjie' });
    const b = buildC2paManifest({ ...MANIFEST_BASE, brand: 'bossnyumba' });
    expect(a.signature.value).not.toBe(b.signature.value);
  });

  it('defaults to brand=borjie + tenant_id=empty for backwards compatibility', () => {
    const m = buildC2paManifest(MANIFEST_BASE);
    const credentials = m.assertions[1]?.data as Record<string, unknown>;
    expect(credentials['brand']).toBe('borjie');
    expect(credentials['tenant_id']).toBe('');
  });

  it('round-trips tenant_id through embed → extract', () => {
    const m = buildC2paManifest({
      ...MANIFEST_BASE,
      tenant_id: 'tenant-roundtrip',
    });
    const embedded = embedC2paManifest({
      bytes: Buffer.from('image'),
      manifest: m,
    });
    const back = extractC2paManifest(embedded);
    const back_credentials = back?.assertions[1]?.data as Record<string, unknown>;
    expect(back_credentials['tenant_id']).toBe('tenant-roundtrip');
  });
});

describe('Caveat 1 — visible watermark plan wired into composer', () => {
  it('attaches an image visible-watermark plan to a Tier-0 briefing thumbnail', async () => {
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [fakeAdapter()],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: makeCtx(),
      registry,
    });
    const plan = readVisibleWatermarkPlan(artifact);
    expect(plan).not.toBeNull();
    expect(plan?.format).toBe('image');
    expect(plan?.position).toBe('lower_right');
    expect(plan?.sharp_composite?.gravity).toBe('southeast');
  });

  it('tenant_id flows into the artifact body via embedded C2PA', async () => {
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [fakeAdapter()],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: makeCtx({ tenant_id: 'tenant-sealed-c2pa' }),
      registry,
    });
    const manifest = extractC2paManifest(artifact.body);
    const credentials = manifest?.assertions[1]?.data as Record<string, unknown>;
    expect(credentials['tenant_id']).toBe('tenant-sealed-c2pa');
  });

  it('artifact remains MediaArtifact-shaped (plan is non-enumerable)', async () => {
    const recipe = buildBriefingThumbnailRecipe({
      adapters: [fakeAdapter()],
    });
    const registry = new MediaRecipeRegistry([recipe]);
    const artifact = await composeMedia({
      recipe_id: 'briefing_thumbnail',
      ctx: makeCtx(),
      registry,
    });
    expect(Object.keys(artifact)).not.toContain('__visibleWatermarkPlan');
    // Still accessible through the helper.
    expect(readVisibleWatermarkPlan(artifact)).not.toBeNull();
  });
});
