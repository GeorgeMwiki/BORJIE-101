/**
 * Tests for `createMediaDispatcher` — the thin ad-hoc image dispatcher
 * that the api-gateway brain tool (`mining.media.generate_image`) probes
 * for. These lock in the contract image-generator.ts depends on:
 *   - the factory exists and exposes a `.generate({kind,prompt,...})` method;
 *   - a REAL provider label comes back when ≥1 provider env key is set;
 *   - the dispatcher degrades by throwing PROVIDER_NOT_AVAILABLE (so the
 *     caller renders its own fallback) when NO provider key is configured.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMediaDispatcher } from '../media-dispatcher.js';
import { MediaCompositionError } from '../types.js';

const IMAGE_PROVIDER_KEYS = [
  'FLUX_API_KEY',
  'IDEOGRAM_API_KEY',
  'RECRAFT_API_KEY',
  'GOOGLE_API_KEY',
  'SD35_API_KEY',
] as const;

/** A fetch stub that returns a valid Flux response body. */
function fluxOkFetch(): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 'flux-test-1', status: 'ready' }),
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('createMediaDispatcher', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of IMAGE_PROVIDER_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of IMAGE_PROVIDER_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('exposes a generate() method', () => {
    const dispatcher = createMediaDispatcher();
    expect(dispatcher).not.toBeNull();
    expect(typeof dispatcher.generate).toBe('function');
  });

  it('returns a REAL provider label (not a fallback) when a provider key is set', async () => {
    process.env.FLUX_API_KEY = 'test-flux-key';
    const dispatcher = createMediaDispatcher({ fetchImpl: fluxOkFetch() });

    const out = await dispatcher.generate({
      kind: 'image',
      prompt: 'a granite outcrop at dawn over a Tanzanian gold site',
      aspectRatio: '1:1',
    });

    expect(out.provider).toBe('flux');
    expect(out.provider).not.toBe('fallback-1x1');
    expect(Buffer.isBuffer(out.blob)).toBe(true);
    expect(out.blob.length).toBeGreaterThan(0);
  });

  it('maps a square pixel size to a 1:1 aspect ratio', async () => {
    process.env.FLUX_API_KEY = 'test-flux-key';
    const dispatcher = createMediaDispatcher({ fetchImpl: fluxOkFetch() });
    const out = await dispatcher.generate({
      kind: 'image',
      prompt: 'an assay laboratory bench',
      size: '512x512',
    });
    expect(out.provider).toBe('flux');
  });

  it('throws PROVIDER_NOT_AVAILABLE when no provider key is configured', async () => {
    const dispatcher = createMediaDispatcher({ fetchImpl: fluxOkFetch() });
    await expect(
      dispatcher.generate({ kind: 'image', prompt: 'a haul truck' }),
    ).rejects.toBeInstanceOf(MediaCompositionError);
  });

  it('rejects an empty prompt', async () => {
    const dispatcher = createMediaDispatcher();
    await expect(
      dispatcher.generate({ kind: 'image', prompt: '   ' }),
    ).rejects.toThrow(/prompt/);
  });
});
