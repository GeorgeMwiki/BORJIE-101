/**
 * Safety pipeline tests — NSFW scanner, deepfake detector, brand
 * violation scanner. All scanners graceful-degrade when their API
 * keys are absent.
 */

import { describe, expect, it } from 'vitest';
import {
  NSFW_TIER_THRESHOLDS,
  scanForNsfw,
} from '../safety/nsfw-scanner.js';
import {
  DEEPFAKE_TIER_THRESHOLDS,
  detectDeepfake,
} from '../safety/deepfake-detector.js';
import { scanBrandViolation } from '../safety/brand-violation-scanner.js';
import { BorjieBrandSpec } from '../brand-lock/brand-spec.js';

const previousEnv = { ...process.env };
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in previousEnv)) delete process.env[k];
  }
});

const fetchOk = (body: string): typeof fetch =>
  (async () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

describe('scanForNsfw', () => {
  it('returns permissive 0 when no scanner configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.NSFWJS_ENABLED;
    const result = await scanForNsfw({
      artifact_bytes: Buffer.from('image'),
      format: 'image',
    });
    expect(result.probability).toBe(0);
    expect(result.scanner).toBe('none');
  });

  it('parses OpenAI moderation response when keyed', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const result = await scanForNsfw({
      artifact_bytes: Buffer.from('image'),
      format: 'image',
      artifact_url: 'https://x/image.png',
      fetchImpl: fetchOk(
        JSON.stringify({
          results: [
            {
              flagged: false,
              category_scores: { sexual: 0.02, violence: 0.01 },
            },
          ],
        }),
      ),
    });
    expect(result.scanner).toBe('openai-moderation');
    expect(result.probability).toBeCloseTo(0.02);
  });

  it('exposes per-tier thresholds', () => {
    expect(NSFW_TIER_THRESHOLDS.tier_2).toBeLessThan(
      NSFW_TIER_THRESHOLDS.tier_1,
    );
    expect(NSFW_TIER_THRESHOLDS.tier_1).toBeLessThan(
      NSFW_TIER_THRESHOLDS.tier_0,
    );
  });
});

describe('detectDeepfake', () => {
  it('returns permissive 0 when key absent', async () => {
    delete process.env.REALITY_DEFENDER_API_KEY;
    const result = await detectDeepfake({
      artifact_url: 'https://x/video.mp4',
      format: 'short_video',
    });
    expect(result.probability).toBe(0);
    expect(result.scanner).toBe('none');
  });

  it('parses Reality Defender response when keyed', async () => {
    process.env.REALITY_DEFENDER_API_KEY = 'rd-test';
    const result = await detectDeepfake({
      artifact_url: 'https://x/video.mp4',
      format: 'short_video',
      fetchImpl: fetchOk(
        JSON.stringify({
          status: 'done',
          result: { score: 0.42, flagged_frames: [2.4, 5.1] },
        }),
      ),
    });
    expect(result.scanner).toBe('reality-defender');
    expect(result.probability).toBeCloseTo(0.42);
    expect(result.flagged_frames_sec).toEqual([2.4, 5.1]);
  });

  it('exposes per-tier thresholds with Tier-2 strictest', () => {
    expect(DEEPFAKE_TIER_THRESHOLDS.tier_2).toBeLessThan(
      DEEPFAKE_TIER_THRESHOLDS.tier_1,
    );
  });
});

describe('scanBrandViolation', () => {
  it('returns ok=true (permissive) without ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await scanBrandViolation({
      artifact_bytes: Buffer.from('image'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'briefing_thumbnail',
      expect_wordmark: true,
    });
    expect(result.ok).toBe(true);
    expect(result.flags).toEqual([]);
  });
});
