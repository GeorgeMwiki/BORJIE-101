/**
 * Brand-lock prompt prefix + output validator tests.
 */

import { describe, expect, it } from 'vitest';
import { BorjieBrandSpec, getBrandSpec } from '../brand-lock/brand-spec.js';
import {
  buildBrandPrefix,
  buildBrandedPrompt,
  buildNegativePrompt,
  hasBrandPrefix,
} from '../brand-lock/prompt-prefix-builder.js';
import {
  DEFAULT_THRESHOLDS,
  validateOutputBrand,
} from '../brand-lock/output-validator.js';

describe('BorjieBrandSpec', () => {
  it('declares the Borjie brand', () => {
    expect(BorjieBrandSpec.brand).toBe('borjie');
  });

  it('carries the five canonical palette anchors', () => {
    expect(BorjieBrandSpec.palette.length).toBeGreaterThanOrEqual(5);
    const names = BorjieBrandSpec.palette.map((p) => p.name);
    expect(names).toContain('signal_primary');
    expect(names).toContain('foreground_neutral');
    expect(names).toContain('surface_background');
  });

  it('requires consent token for real persons', () => {
    expect(BorjieBrandSpec.real_person_consent_required).toBe(true);
  });

  it('getBrandSpec(any tenant) returns the Borjie default', () => {
    expect(getBrandSpec('tenant-a')).toBe(BorjieBrandSpec);
    expect(getBrandSpec('tenant-b')).toBe(BorjieBrandSpec);
  });
});

describe('prompt-prefix-builder', () => {
  it('emits the canonical prefix string', () => {
    const prefix = buildBrandPrefix(BorjieBrandSpec);
    expect(prefix).toContain('Photographic style');
    expect(prefix).toContain('borjie OKLCH palette');
    expect(prefix).toContain('Typography on graphics');
    expect(prefix).toContain('Wordmark policy');
    expect(prefix).toContain('Avoid:');
  });

  it('appends the subject after the prefix', () => {
    const prompt = buildBrandedPrompt(BorjieBrandSpec, 'Hero shot of parcel');
    expect(prompt).toContain('Hero shot of parcel');
    expect(hasBrandPrefix(prompt, BorjieBrandSpec)).toBe(true);
  });

  it('builds a negative prompt from the denylist', () => {
    const neg = buildNegativePrompt(BorjieBrandSpec);
    expect(neg).toContain('NSFW');
    expect(neg).toContain('watermark removal');
  });

  it('hasBrandPrefix rejects an off-brand prompt', () => {
    expect(hasBrandPrefix('Hero shot of parcel', BorjieBrandSpec)).toBe(false);
  });
});

describe('output-validator', () => {
  it('returns permissive default when vision fn missing', async () => {
    const result = await validateOutputBrand({
      artifact_bytes: Buffer.from('x'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'r',
      expect_wordmark: true,
    });
    expect(result.ok).toBe(true);
    expect(result.violation_flags).toEqual([]);
  });

  it('flags below-threshold palette density', async () => {
    const result = await validateOutputBrand({
      artifact_bytes: Buffer.from('x'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'r',
      expect_wordmark: true,
      visionApiFn: async () => ({
        palette_density: 0.1,
        wordmark_integrity: 1,
        signature_treatment: 1,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.violation_flags).toContain('palette_density_below_threshold');
  });

  it('flags below-threshold wordmark integrity when expected', async () => {
    const result = await validateOutputBrand({
      artifact_bytes: Buffer.from('x'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'r',
      expect_wordmark: true,
      visionApiFn: async () => ({
        palette_density: 1,
        wordmark_integrity: 0.2,
        signature_treatment: 1,
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.violation_flags).toContain(
      'wordmark_integrity_below_threshold',
    );
  });

  it('does not flag wordmark when expect_wordmark=false', async () => {
    const result = await validateOutputBrand({
      artifact_bytes: Buffer.from('x'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'r',
      expect_wordmark: false,
      visionApiFn: async () => ({
        palette_density: 1,
        wordmark_integrity: 0,
        signature_treatment: 1,
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('falls back to permissive default on vision exception', async () => {
    const result = await validateOutputBrand({
      artifact_bytes: Buffer.from('x'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'r',
      expect_wordmark: true,
      visionApiFn: async () => {
        throw new Error('vision-down');
      },
    });
    expect(result.ok).toBe(true);
  });

  it('exposes the canonical thresholds', () => {
    expect(DEFAULT_THRESHOLDS.palette_density).toBeGreaterThan(0);
    expect(DEFAULT_THRESHOLDS.wordmark_integrity).toBeGreaterThan(0);
    expect(DEFAULT_THRESHOLDS.signature_treatment).toBeGreaterThan(0);
  });
});
