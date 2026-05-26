/**
 * Watermark tests — C2PA embed/extract round-trip + visible watermark
 * plan shape.
 */

import { describe, expect, it } from 'vitest';
import {
  buildC2paManifest,
  embedC2paManifest,
  extractC2paManifest,
} from '../watermark/c2pa-embedder.js';
import {
  planVisibleWatermark,
  watermarkedExtension,
} from '../watermark/visible-watermark.js';
import { BorjieBrandSpec } from '../brand-lock/brand-spec.js';
import type { MediaProvenance } from '../types.js';

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

describe('buildC2paManifest', () => {
  it('emits the canonical manifest shape', () => {
    const m = buildC2paManifest({
      recipe_id: 'briefing_thumbnail',
      recipe_version: 1,
      audit_hash: 'a'.repeat(64),
      checksum: 'b'.repeat(64),
      provenance: PROVENANCE,
      generated_at: '2026-05-26T00:00:00.000Z',
    });
    expect(m.version).toBe('1.4');
    expect(m.claim_generator).toBe('borjie/media-generation');
    expect(m.title).toBe('briefing_thumbnail@1');
    expect(m.assertions.length).toBeGreaterThanOrEqual(2);
    expect(m.signature.algorithm).toBe('sha256');
    expect(m.signature.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a different signature when tenant_secret changes', () => {
    const args = {
      recipe_id: 'briefing_thumbnail',
      recipe_version: 1,
      audit_hash: 'a'.repeat(64),
      checksum: 'b'.repeat(64),
      provenance: PROVENANCE,
      generated_at: '2026-05-26T00:00:00.000Z',
    };
    const a = buildC2paManifest({ ...args });
    const b = buildC2paManifest({ ...args, tenant_secret: 'shh' });
    expect(a.signature.value).not.toBe(b.signature.value);
  });
});

describe('embedC2paManifest + extractC2paManifest', () => {
  it('round-trips the manifest', () => {
    const m = buildC2paManifest({
      recipe_id: 'briefing_thumbnail',
      recipe_version: 1,
      audit_hash: 'a'.repeat(64),
      checksum: 'b'.repeat(64),
      provenance: PROVENANCE,
      generated_at: '2026-05-26T00:00:00.000Z',
    });
    const embedded = embedC2paManifest({
      bytes: Buffer.from('image-bytes'),
      manifest: m,
    });
    const back = extractC2paManifest(embedded);
    expect(back?.title).toBe('briefing_thumbnail@1');
    expect(back?.assertions.length).toBe(m.assertions.length);
  });

  it('extract returns null when no manifest present', () => {
    expect(extractC2paManifest(Buffer.from('no-manifest'))).toBeNull();
  });

  it('honours embedFn override', () => {
    const m = buildC2paManifest({
      recipe_id: 'r',
      recipe_version: 1,
      audit_hash: 'a',
      checksum: 'b',
      provenance: PROVENANCE,
      generated_at: '2026-05-26T00:00:00.000Z',
    });
    const result = embedC2paManifest({
      bytes: Buffer.from('x'),
      manifest: m,
      embedFn: () => Buffer.from('CUSTOM'),
    });
    expect(result.toString('utf-8')).toBe('CUSTOM');
  });
});

describe('planVisibleWatermark', () => {
  it('returns sharp composite for images', () => {
    const plan = planVisibleWatermark({
      format: 'image',
      brand: BorjieBrandSpec,
    });
    expect(plan.format).toBe('image');
    expect(plan.position).toBe('lower_right');
    expect(plan.sharp_composite).toBeDefined();
    expect(plan.sharp_composite?.gravity).toBe('southeast');
  });

  it('returns ffmpeg filter for video', () => {
    const plan = planVisibleWatermark({
      format: 'short_video',
      brand: BorjieBrandSpec,
    });
    expect(plan.format).toBe('short_video');
    expect(plan.ffmpeg_filter).toContain('overlay=W-w-24:H-h-24');
  });

  it('honours opacity override', () => {
    const plan = planVisibleWatermark({
      format: 'short_video',
      brand: BorjieBrandSpec,
      opacity: 0.5,
    });
    expect(plan.opacity).toBe(0.5);
    expect(plan.ffmpeg_filter).toContain('aa=0.50');
  });

  it('watermarkedExtension distinguishes image vs video', () => {
    expect(watermarkedExtension('image')).toContain('png');
    expect(watermarkedExtension('short_video')).toContain('mp4');
    expect(watermarkedExtension('lipsync_video')).toContain('mp4');
  });
});
