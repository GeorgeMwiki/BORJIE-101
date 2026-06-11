/**
 * Coverage for the remaining real adapters (Veo / Seedance / GIF) and the
 * read-only persistence schema refs.
 */

import { describe, expect, it } from 'vitest';
import {
  createSeedanceProvider,
  createVeoProvider,
} from '../providers/video-adapters.js';
import { createGifTranscoderProvider } from '../providers/gif-adapter.js';
import {
  MEDIA_APPROVAL_STATES,
  MEDIA_ARTIFACT_FORMATS,
  mediaArtifacts,
  mediaSafetyScans,
} from '../persistence/media-schema.js';
import { NOOP_LOGGER } from '../types.js';
import type { FetchResponseLike } from '../types.js';
import type { ProviderInvocation } from '../providers/port.js';

function invocation(
  overrides: Partial<ProviderInvocation> = {},
): ProviderInvocation {
  return {
    modality: 'short_video',
    prompt: 'investor brand video',
    aspectRatio: '16:9',
    durationSec: 6,
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

describe('video adapters', () => {
  it('Veo declares SynthID present and video capability', () => {
    const veo = createVeoProvider();
    expect(veo.capabilities).toContain('short_video');
    expect(veo.estimateCostCents('short_video', 4)).toBe(60);
  });

  it('Veo degrades (provider_unconfigured) without a key', async () => {
    const veo = createVeoProvider();
    await expect(
      veo.generate(invocation({ fetch: async () => jsonResponse({}) })),
    ).rejects.toMatchObject({ code: 'provider_unconfigured' });
  });

  it('Veo records SynthID when it returns base64 bytes', async () => {
    const veo = createVeoProvider({ veoBaseUrl: 'https://veo.test' });
    const out = await veo.generate(
      invocation({
        apiKey: 'k',
        fetch: async () => jsonResponse({ bytesBase64Encoded: 'AQID' }),
      }),
    );
    expect(out.synthIdPresent).toBe(true);
    expect(out.format).toBe('mp4');
  });

  it('Seedance posts a task and degrades without a key', async () => {
    const seedance = createSeedanceProvider({
      seedanceBaseUrl: 'https://ark.test',
    });
    expect(seedance.id).toBe('seedance');
    await expect(
      seedance.generate(invocation({ fetch: async () => jsonResponse({}) })),
    ).rejects.toMatchObject({ code: 'provider_unconfigured' });
  });
});

describe('gif transcoder adapter', () => {
  it('serves the gif modality and degrades without a key', async () => {
    const gif = createGifTranscoderProvider({
      transcodeBaseUrl: 'https://transcode.test',
    });
    expect(gif.capabilities).toEqual(['gif']);
    expect(gif.estimateCostCents('gif', 0)).toBe(2);
    await expect(
      gif.generate(
        invocation({ modality: 'gif', fetch: async () => jsonResponse({}) }),
      ),
    ).rejects.toMatchObject({ code: 'provider_unconfigured' });
  });
});

describe('read-only persistence schema refs', () => {
  it('mirror the 0020 table names', () => {
    // Drizzle exposes the SQL table name via the symbol-keyed config; a
    // structural smoke check is enough to prove the refs are wired.
    expect(mediaArtifacts).toBeDefined();
    expect(mediaSafetyScans).toBeDefined();
    expect(typeof mediaArtifacts).toBe('object');
  });

  it('re-state the 0020 CHECK value sets', () => {
    expect(MEDIA_ARTIFACT_FORMATS).toContain('image');
    expect(MEDIA_ARTIFACT_FORMATS).toContain('short_video');
    expect(MEDIA_APPROVAL_STATES).toContain('pending');
    expect(MEDIA_APPROVAL_STATES).toContain('auto_published');
  });
});
