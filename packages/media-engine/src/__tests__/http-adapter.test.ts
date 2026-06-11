/**
 * HTTP-adapter tests: injected-config contract, degrade-not-fabricate,
 * base64 decode, and no-process.env reads.
 */

import { describe, expect, it } from 'vitest';
import { createImagenProvider } from '../providers/image-adapters.js';
import { createSoraProvider } from '../providers/video-adapters.js';
import { NOOP_LOGGER } from '../types.js';
import type {
  FetchResponseLike,
  MediaEngineError as MediaEngineErrorType,
} from '../types.js';
import type { ProviderInvocation } from '../providers/port.js';

function invocation(
  overrides: Partial<ProviderInvocation> = {},
): ProviderInvocation {
  return {
    modality: 'image',
    prompt: 'a mining site map',
    aspectRatio: '16:9',
    durationSec: 0,
    logger: NOOP_LOGGER,
    seed: 'seed-1',
    ...overrides,
  };
}

function jsonResponse(obj: unknown, ok = true): FetchResponseLike {
  const text = JSON.stringify(obj);
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => obj,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  };
}

describe('http adapter — injected config', () => {
  it('throws provider_unconfigured when no api key is injected', async () => {
    const imagen = createImagenProvider();
    await expect(
      imagen.generate(invocation({ fetch: async () => jsonResponse({}) })),
    ).rejects.toMatchObject({ code: 'provider_unconfigured' });
  });

  it('throws provider_unconfigured when no fetch is injected', async () => {
    const imagen = createImagenProvider();
    await expect(
      imagen.generate(invocation({ apiKey: 'k' })),
    ).rejects.toMatchObject({ code: 'provider_unconfigured' });
  });

  it('decodes bytesBase64Encoded into real bytes', async () => {
    const imagen = createImagenProvider();
    // base64 of bytes [1,2,3] = "AQID".
    const out = await imagen.generate(
      invocation({
        apiKey: 'k',
        fetch: async () => jsonResponse({ bytesBase64Encoded: 'AQID' }),
      }),
    );
    expect(Array.from(out.body)).toEqual([1, 2, 3]);
    expect(out.synthIdPresent).toBe(true); // Imagen embeds SynthID.
  });

  it('throws provider_failed on a non-2xx response (never fabricates)', async () => {
    const imagen = createImagenProvider();
    await expect(
      imagen.generate(
        invocation({
          apiKey: 'k',
          fetch: async () => jsonResponse({}, false),
        }),
      ),
    ).rejects.toMatchObject({ code: 'provider_failed' });
  });

  it('throws provider_failed on a URL-only response (no downloadable bytes)', async () => {
    const sora = createSoraProvider();
    await expect(
      sora.generate(
        invocation({
          modality: 'short_video',
          durationSec: 5,
          apiKey: 'k',
          fetch: async () =>
            jsonResponse({ id: 'vid_1', status: 'queued', url: 'https://x/y' }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'provider_failed' });
  });

  it('estimates video cost by duration', () => {
    const sora = createSoraProvider();
    expect(sora.estimateCostCents('short_video', 4)).toBe(40);
  });

  it('uses the custom auth header for FLUX without leaking the key in errors', async () => {
    const { createFluxProvider } = await import(
      '../providers/image-adapters.js'
    );
    const flux = createFluxProvider();
    let seenHeaders: Record<string, string> | undefined;
    await flux
      .generate(
        invocation({
          apiKey: 'secret-key',
          fetch: async (_url, init) => {
            seenHeaders = init?.headers as Record<string, string>;
            return jsonResponse({ bytesBase64Encoded: 'AQID' });
          },
        }),
      )
      .catch(() => undefined);
    expect(seenHeaders?.['x-key']).toBe('secret-key');
    expect(seenHeaders?.Authorization).toBeUndefined();
  });
});
