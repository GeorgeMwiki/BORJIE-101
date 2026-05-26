/**
 * Brand-violation scanner — Haiku vision wiring tests.
 *
 * Asserts the Haiku branch when ANTHROPIC_API_KEY is set. The fetch
 * impl is mocked to return a JSON response in the expected Claude
 * messages-API shape.
 */

import { describe, expect, it } from 'vitest';
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

const fetchFail = (): typeof fetch =>
  (async () => new Response('boom', { status: 500 })) as unknown as typeof fetch;

describe('scanBrandViolation — Haiku wiring', () => {
  it('builds vision fn when ANTHROPIC_API_KEY present + reports brand pass', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const fetchImpl = fetchOk(
      JSON.stringify({
        content: [
          {
            text: JSON.stringify({
              palette_density: 0.9,
              wordmark_integrity: 0.95,
              signature_treatment: 0.8,
            }),
          },
        ],
      }),
    );
    const result = await scanBrandViolation({
      artifact_bytes: Buffer.from('image-bytes'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'briefing_thumbnail',
      expect_wordmark: true,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.palette_density).toBeCloseTo(0.9);
    expect(result.wordmark_integrity).toBeCloseTo(0.95);
  });

  it('reports flags when palette density below threshold', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const fetchImpl = fetchOk(
      JSON.stringify({
        content: [
          {
            text: JSON.stringify({
              palette_density: 0.1,
              wordmark_integrity: 1,
              signature_treatment: 1,
            }),
          },
        ],
      }),
    );
    const result = await scanBrandViolation({
      artifact_bytes: Buffer.from('image-bytes'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'briefing_thumbnail',
      expect_wordmark: true,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.flags).toContain('palette_density_below_threshold');
  });

  it('falls back permissively when haiku fetch fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const result = await scanBrandViolation({
      artifact_bytes: Buffer.from('image-bytes'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'briefing_thumbnail',
      expect_wordmark: true,
      fetchImpl: fetchFail(),
    });
    expect(result.ok).toBe(true);
  });

  it('handles non-JSON haiku response gracefully', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const fetchImpl = fetchOk(
      JSON.stringify({
        content: [{ text: 'not-valid-json' }],
      }),
    );
    const result = await scanBrandViolation({
      artifact_bytes: Buffer.from('image-bytes'),
      format: 'image',
      brand: BorjieBrandSpec,
      recipe_id: 'briefing_thumbnail',
      expect_wordmark: true,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
  });
});
