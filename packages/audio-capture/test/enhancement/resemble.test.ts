import { describe, expect, it, vi } from 'vitest';
import { createResembleEnhanceAdapter } from '../../src/enhancement/resemble.js';
import { createKrispAdapter } from '../../src/enhancement/krisp.js';
import { AudioCaptureError, type AudioChunk } from '../../src/types.js';

const audio = (): AudioChunk => ({
  bytes: new Uint8Array(8),
  format: 'wav',
  sampleRate: 16000,
  channels: 1,
});

describe('createResembleEnhanceAdapter', () => {
  it('requires an API key', async () => {
    const e = createResembleEnhanceAdapter({ apiKey: undefined });
    await expect(
      e.enhance({ audio: audio(), target: 'denoise' }),
    ).rejects.toBeInstanceOf(AudioCaptureError);
  });

  it('returns enhanced bytes from the upstream', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([1, 1, 1, 1]), { status: 200 }),
    );
    const e = createResembleEnhanceAdapter({ apiKey: 'rk', fetchImpl: fetchMock });
    const out = await e.enhance({ audio: audio(), target: 'denoise' });
    expect(Array.from(out.bytes)).toEqual([1, 1, 1, 1]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/mode=denoise/);
  });
});

describe('createKrispAdapter', () => {
  it('uses X-Krisp-Key auth and posts the audio', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([2, 2]), { status: 200 }),
    );
    const e = createKrispAdapter({ apiKey: 'kk', fetchImpl: fetchMock });
    const out = await e.enhance({ audio: audio(), target: 'dereverb' });
    expect(Array.from(out.bytes)).toEqual([2, 2]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Krisp-Key']).toBe('kk');
  });
});
