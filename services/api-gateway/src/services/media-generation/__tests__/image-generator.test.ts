/**
 * Regression tests for the image-generation wiring.
 *
 * Before the fix, `getDispatcher()` probed `@borjie/media-generation` for a
 * `createMediaDispatcher` export that did not exist, so it ALWAYS returned
 * null and `generateImage` ALWAYS returned the hardcoded 1x1 fallback PNG —
 * a false-green: the brain tool reported `ok:true` while emitting a blank
 * 1x1 image regardless of provider configuration.
 *
 * These lock in the repaired contract:
 *   - `getDispatcher()` resolves NON-NULL now that the package exports the
 *     factory (the exact assertion the fix brief called for);
 *   - `generateImage` returns a REAL provider label when a provider key is
 *     set (never `fallback-1x1`);
 *   - `generateImage` still degrades cleanly to `fallback-1x1` when no
 *     provider key is configured.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetDispatcherForTests,
  generateImage,
  getDispatcher,
} from '../image-generator.js';

const IMAGE_PROVIDER_KEYS = [
  'FLUX_API_KEY',
  'IDEOGRAM_API_KEY',
  'RECRAFT_API_KEY',
  'GOOGLE_API_KEY',
  'SD35_API_KEY',
] as const;

/** A fetch stub that returns a valid Flux response body. */
function fluxOkFetch(): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ id: 'flux-test-1', status: 'ready' }),
  })) as unknown as typeof fetch;
}

describe('image-generator dispatcher wiring', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    __resetDispatcherForTests();
    for (const k of IMAGE_PROVIDER_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    __resetDispatcherForTests();
    vi.unstubAllGlobals();
    for (const k of IMAGE_PROVIDER_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('getDispatcher() resolves non-null now that @borjie/media-generation exports the factory', async () => {
    const dispatcher = await getDispatcher();
    expect(dispatcher).not.toBeNull();
    expect(dispatcher).toBeTypeOf('object');
  });

  it('generateImage returns a REAL provider label (not fallback-1x1) when a provider key is set', async () => {
    process.env.FLUX_API_KEY = 'test-flux-key';
    vi.stubGlobal('fetch', fluxOkFetch());

    const out = await generateImage({
      prompt: 'a gold-bearing reef cross-section, technical illustration',
      aspectRatio: '1:1',
    });

    expect(out.providerLabel).toBe('flux');
    expect(out.providerLabel).not.toBe('fallback-1x1');
    expect(Buffer.isBuffer(out.blob)).toBe(true);
    expect(out.blob.length).toBeGreaterThan(0);
  });

  it('generateImage degrades to fallback-1x1 when no provider key is configured', async () => {
    const out = await generateImage({ prompt: 'a haul truck on a haul road' });
    expect(out.providerLabel).toBe('fallback-1x1');
    expect(Buffer.isBuffer(out.blob)).toBe(true);
    expect(out.blob.length).toBeGreaterThan(0);
  });
});
