/**
 * STT provider factory tests — verify the env-gated honest provider:
 *
 *   1. UNCONFIGURED (no key) → throwing port that raises
 *      STT_PROVIDER_NOT_CONFIGURED on use, NEVER a fake transcript.
 *   2. UNCONFIGURED + `unconfiguredMode: 'null-port'` → `port: null`.
 *   3. CONFIGURED (STT_API_KEY) → real port that downloads the audioUrl
 *      and transcribes through the injected audio-capture STT port.
 *   4. STT_API_KEY takes precedence over OPENAI_API_KEY.
 *   5. confidence is averaged from segments — null when none carry one
 *      (honest "unknown", never a fabricated 1.0).
 *   6. language hint is normalised; unknown hints fall back to 'auto'
 *      (never a hard-coded 'en').
 *   7. content-type / extension drive container inference.
 *   8. credential is read from the injected env object, NOT process.env.
 */

import { describe, it, expect, vi } from 'vitest';
import type { STTPort, STTResult } from '@borjie/audio-capture';
import {
  createSttProvider,
  resolveSttApiKey,
  normaliseLanguage,
  inferAudioFormat,
  SttProviderNotConfiguredError,
  STT_PROVIDER_NOT_CONFIGURED,
} from '../voice/stt-provider-factory';

function fakeSttPort(result: STTResult): STTPort {
  return {
    modelId: result.modelId,
    provider: 'fake',
    transcribe: vi.fn(async () => result),
    // eslint-disable-next-line @typescript-eslint/require-await
    async *streamTranscribe() {
      // not exercised here
    },
  };
}

function fakeFetchReturning(
  bytes: Uint8Array,
  contentType = 'audio/wav',
): typeof fetch {
  return vi.fn(async () =>
    new Response(bytes, {
      status: 200,
      headers: { 'content-type': contentType },
    }),
  ) as unknown as typeof fetch;
}

describe('createSttProvider — unconfigured', () => {
  it('returns a throwing port when no key is present', async () => {
    const result = createSttProvider({ env: {} });
    expect(result.configured).toBe(false);
    expect(result.provider).toBe('unconfigured');
    expect(result.modelId).toBeNull();
    expect(result.port).not.toBeNull();

    await expect(
      result.port!.transcribe({ audioUrl: 'https://x/a.wav' }),
    ).rejects.toBeInstanceOf(SttProviderNotConfiguredError);

    // The thrown error carries the stable code (no string-matching needed).
    await result.port!
      .transcribe({ audioUrl: 'https://x/a.wav' })
      .catch((err: unknown) => {
        expect((err as { code?: string }).code).toBe(
          STT_PROVIDER_NOT_CONFIGURED,
        );
      });
  });

  it('returns port:null under null-port mode', () => {
    const result = createSttProvider({
      env: {},
      unconfiguredMode: 'null-port',
    });
    expect(result.configured).toBe(false);
    expect(result.port).toBeNull();
  });

  it('treats whitespace-only keys as absent', () => {
    const result = createSttProvider({ env: { STT_API_KEY: '   ' } });
    expect(result.configured).toBe(false);
  });
});

describe('createSttProvider — configured', () => {
  const sttResult: STTResult = {
    transcript: 'tumechimba tani kumi leo',
    segments: [
      { text: 'tumechimba', startMs: 0, endMs: 500, confidence: 0.8, isFinal: true },
      { text: 'tani kumi', startMs: 500, endMs: 1200, confidence: 0.9, isFinal: true },
    ],
    language: 'sw',
    durationMs: 1200,
    modelId: 'whisper-large-v3-turbo',
  };

  it('downloads audio + transcribes through the injected STT port', async () => {
    const sttPortOverride = fakeSttPort(sttResult);
    const fetchImpl = fakeFetchReturning(new Uint8Array([1, 2, 3]));
    const provider = createSttProvider({
      env: { STT_API_KEY: 'sk-test' },
      sttPortOverride,
      fetchImpl,
    });

    expect(provider.configured).toBe(true);
    expect(provider.provider).toBe('openai-whisper');

    const out = await provider.port!.transcribe({
      audioUrl: 'https://bucket/voice/turn-1.wav',
      languageHint: 'sw',
    });

    expect(out).not.toBeNull();
    expect(out!.transcript).toBe('tumechimba tani kumi leo');
    expect(out!.detectedLanguage).toBe('sw');
    // (0.8 + 0.9) / 2
    expect(out!.confidence).toBeCloseTo(0.85, 5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sttPortOverride.transcribe).toHaveBeenCalledTimes(1);
  });

  it('returns null confidence when no segment carries one', async () => {
    const noConf: STTResult = {
      ...sttResult,
      segments: [{ text: 'x', startMs: 0, endMs: 10, isFinal: true }],
    };
    const provider = createSttProvider({
      env: { OPENAI_API_KEY: 'sk-test' },
      sttPortOverride: fakeSttPort(noConf),
      fetchImpl: fakeFetchReturning(new Uint8Array([0])),
    });
    const out = await provider.port!.transcribe({
      audioUrl: 'https://x/a.wav',
    });
    expect(out!.confidence).toBeNull();
  });

  it('throws on a failed audio download', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('nope', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch;
    const provider = createSttProvider({
      env: { STT_API_KEY: 'sk-test' },
      sttPortOverride: fakeSttPort(sttResult),
      fetchImpl,
    });
    await expect(
      provider.port!.transcribe({ audioUrl: 'https://x/missing.wav' }),
    ).rejects.toThrow(/download failed/i);
  });
});

describe('resolveSttApiKey', () => {
  it('prefers STT_API_KEY over OPENAI_API_KEY', () => {
    expect(
      resolveSttApiKey({ STT_API_KEY: 'a', OPENAI_API_KEY: 'b' }),
    ).toBe('a');
  });
  it('falls back to OPENAI_API_KEY', () => {
    expect(resolveSttApiKey({ OPENAI_API_KEY: 'b' })).toBe('b');
  });
  it('returns undefined when neither is set', () => {
    expect(resolveSttApiKey({})).toBeUndefined();
  });
});

describe('normaliseLanguage', () => {
  it('passes through supported tags', () => {
    expect(normaliseLanguage('sw')).toBe('sw');
    expect(normaliseLanguage('en-TZ')).toBe('en-TZ');
  });
  it('collapses unknown region variants to the base when supported', () => {
    expect(normaliseLanguage('sw-XX')).toBe('sw');
  });
  it('falls back to auto for unknown hints (never hard-codes en)', () => {
    expect(normaliseLanguage('klingon')).toBe('auto');
    expect(normaliseLanguage('')).toBe('auto');
  });
});

describe('inferAudioFormat', () => {
  it('prefers content-type', () => {
    expect(inferAudioFormat('https://x/a.bin', 'audio/ogg')).toBe('ogg');
    expect(inferAudioFormat('https://x/a.wav', 'audio/mpeg')).toBe('mp3');
  });
  it('falls back to the URL extension', () => {
    expect(inferAudioFormat('https://x/a.flac', null)).toBe('flac');
    expect(inferAudioFormat('https://x/a.m4a', null)).toBe('aac');
  });
  it('defaults to wav for unknown shapes', () => {
    expect(inferAudioFormat('https://x/a', null)).toBe('wav');
  });
});
