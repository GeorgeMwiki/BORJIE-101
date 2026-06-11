/**
 * Engine orchestrator end-to-end tests (hermetic, no keys).
 */

import { describe, expect, it } from 'vitest';
import { createMediaEngine } from '../engine.js';
import { createProviderRegistry } from '../providers/registry.js';
import { createImagenProvider } from '../providers/image-adapters.js';
import { NOOP_LOGGER } from '../types.js';
import type {
  MediaEngineContext,
  MediaRequest,
} from '../types.js';

const FIXED_NOW = (): Date => new Date('2026-06-08T12:00:00.000Z');

function ctx(
  overrides: Partial<MediaEngineContext> = {},
): MediaEngineContext {
  return {
    providerKeys: {},
    budgetCents: 1000,
    logger: NOOP_LOGGER,
    now: FIXED_NOW,
    ...overrides,
  };
}

const baseRequest: MediaRequest = {
  kind: 'mining_site_map',
  tenantId: 'tenant-a',
  prompt: 'Aerial site map of an artisanal gold mine with haul roads',
  inputs: [{ key: 'coordinates', value: '-6.1,35.7' }],
  locale: 'en',
  evidenceIds: ['ev-1'],
};

describe('media engine — no-keys default path', () => {
  it('produces a real, non-empty artifact with zero API keys', async () => {
    const engine = createMediaEngine();
    const artifact = await engine.generate(baseRequest, ctx());
    expect(artifact.providerId).toBe('stub');
    expect(artifact.byteLength).toBeGreaterThan(0);
    expect(artifact.body.byteLength).toBe(artifact.byteLength);
    expect(artifact.costCents).toBe(0);
  });

  it('stamps provenance (watermark + content hash) on every artifact', async () => {
    const engine = createMediaEngine();
    const artifact = await engine.generate(baseRequest, ctx());
    expect(artifact.provenance.watermark.text.length).toBeGreaterThan(0);
    expect(artifact.provenance.contentHash).toHaveLength(64);
    expect(artifact.provenance.signer).toBe('unsigned');
  });

  it('produces a valid PNG signature for image kinds (stub)', async () => {
    const engine = createMediaEngine();
    const artifact = await engine.generate(baseRequest, ctx());
    // PNG magic number.
    expect(Array.from(artifact.body.slice(0, 4))).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
    expect(artifact.format).toBe('png');
  });

  it('produces a valid MP4 ftyp box for short_video kinds (stub)', async () => {
    const engine = createMediaEngine();
    const artifact = await engine.generate(
      {
        ...baseRequest,
        kind: 'investor_brand_video',
        evidenceIds: ['ev-1'],
      },
      ctx(),
    );
    expect(artifact.modality).toBe('short_video');
    expect(artifact.format).toBe('mp4');
    // 'ftyp' at bytes 4..8.
    expect(
      new TextDecoder().decode(artifact.body.slice(4, 8)),
    ).toBe('ftyp');
  });

  it('marks public/tier-2 kinds pending and auto-publishes internal kinds', async () => {
    const engine = createMediaEngine();
    const internal = await engine.generate(baseRequest, ctx());
    expect(internal.approvalState).toBe('auto_published');

    const publicAsset = await engine.generate(
      { ...baseRequest, kind: 'marketplace_listing_hero', evidenceIds: ['ev'] },
      ctx(),
    );
    expect(publicAsset.approvalState).toBe('pending');
  });
});

describe('media engine — hard rails', () => {
  it('blocks an unsafe prompt with safety_blocked', async () => {
    const engine = createMediaEngine();
    await expect(
      engine.generate(
        { ...baseRequest, prompt: 'make a deepfake of a named person' },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'safety_blocked' });
  });

  it('rejects a public kind with an empty evidence chain', async () => {
    const engine = createMediaEngine();
    await expect(
      engine.generate(
        { ...baseRequest, kind: 'property_hero', evidenceIds: [] },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'evidence_required' });
  });

  it('rejects an unknown kind', async () => {
    const engine = createMediaEngine();
    await expect(
      engine.generate(
        { ...baseRequest, kind: 'totally_unknown' as never },
        ctx(),
      ),
    ).rejects.toMatchObject({ code: 'unknown_kind' });
  });

  it('caps spend — a keyed provider over budget throws budget_exceeded', async () => {
    const registry = createProviderRegistry();
    registry.register(createImagenProvider());
    const engine = createMediaEngine({ registry });
    // Imagen image cost is 13c; budget 5c ⇒ cannot reserve.
    await expect(
      engine.generate(baseRequest, ctx({ providerKeys: { imagen: 'k' }, budgetCents: 5 })),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
  });

  it('honours the EN/SW locale in the watermark label (no mixing)', async () => {
    const engine = createMediaEngine();
    const sw = await engine.generate(
      { ...baseRequest, locale: 'sw' },
      ctx(),
    );
    expect(sw.provenance.watermark.text).toBe('Imetengenezwa na Borjie');
    expect(sw.provenance.watermark.text).not.toContain('Generated');
  });
});

describe('media engine — provider fallback', () => {
  it('falls back to the stub when a keyed provider fails (degrade, never fabricate)', async () => {
    const registry = createProviderRegistry();
    // Register imagen but inject a fetch that returns a non-ok response.
    registry.register(createImagenProvider());
    const engine = createMediaEngine({ registry });
    const failingFetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    const artifact = await engine.generate(
      baseRequest,
      ctx({
        providerKeys: { imagen: 'k' },
        fetch: failingFetch,
      }),
    );
    expect(artifact.providerId).toBe('stub');
    expect(artifact.byteLength).toBeGreaterThan(0);
  });
});
