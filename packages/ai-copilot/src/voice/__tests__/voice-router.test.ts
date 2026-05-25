/**
 * Tests for voice/voice-router (Wave 11).
 *
 * Coverage: provider selection per language, fallback on retryable error,
 * stop on non-retryable error, missing-provider error path, ledger
 * pre-flight assertWithinBudget, ledger recordUsage on success, ledger
 * record-failure swallowed, supportsLanguage filter, no providers
 * configured.
 */

import { describe, it, expect, vi } from 'vitest';
import { createVoiceRouter } from '../voice-router.js';
import {
  vErr,
  vOk,
  type SynthesizeRequest,
  type TranscribeRequest,
  type VoiceProvider,
  type VoiceProviderTenantContext,
} from '../types.js';
import type { CostLedger } from '../../cost-ledger.js';

const tenantCtx: VoiceProviderTenantContext = {
  tenantId: 't1',
  correlationId: 'corr-1',
};

function makeProvider(
  id: 'elevenlabs' | 'openai',
  overrides: Partial<VoiceProvider> = {},
): VoiceProvider {
  return {
    providerId: id,
    supportedLanguages: ['en', 'sw', 'mixed'],
    supportsLanguage: () => true,
    healthCheck: async () => true,
    transcribe: async () =>
      vOk({
        text: 'hello',
        language: 'en',
        durationSec: 3,
        providerId: id,
        model: `${id}-stt`,
      }),
    synthesize: async () =>
      vOk({
        audio: new Uint8Array(),
        mimeType: 'audio/mpeg',
        providerId: id,
        model: `${id}-tts`,
        voiceId: 'v1',
      }),
    ...overrides,
  };
}

function makeLedger(
  overrides: Partial<{ assertWithinBudget: ReturnType<typeof vi.fn>; recordUsage: ReturnType<typeof vi.fn> }> = {},
): CostLedger & {
  assertWithinBudget: ReturnType<typeof vi.fn>;
  recordUsage: ReturnType<typeof vi.fn>;
} {
  const assertWithinBudget = overrides.assertWithinBudget ?? vi.fn(async () => undefined);
  const recordUsage = overrides.recordUsage ?? vi.fn(async () => ({} as never));
  return {
    assertWithinBudget,
    recordUsage,
  } as unknown as CostLedger & {
    assertWithinBudget: ReturnType<typeof vi.fn>;
    recordUsage: ReturnType<typeof vi.fn>;
  };
}

const transcribeRequest: TranscribeRequest = {
  audio: new Uint8Array([1, 2, 3]),
  language: 'en',
};

const synthesizeRequest: SynthesizeRequest = {
  text: 'hello world',
  language: 'en',
};

describe('voice-router pickProvider', () => {
  it('returns nothing when no providers are configured', () => {
    const router = createVoiceRouter({ providers: {} });
    expect(router.pickProvider('en')).toEqual([]);
  });

  it('lists configured providers in priority order', () => {
    const router = createVoiceRouter({
      providers: {
        elevenlabs: makeProvider('elevenlabs'),
        openai: makeProvider('openai'),
      },
    });
    expect(router.pickProvider('en')).toEqual(['elevenlabs', 'openai']);
    expect(router.pickProvider('sw')).toEqual(['elevenlabs', 'openai']);
  });

  it('omits providers that are not configured', () => {
    const router = createVoiceRouter({
      providers: { openai: makeProvider('openai') },
    });
    expect(router.pickProvider('en')).toEqual(['openai']);
  });
});

describe('voice-router transcribe', () => {
  it('returns MISSING_KEY when no providers are configured', async () => {
    const router = createVoiceRouter({ providers: {} });
    const result = await router.transcribe(tenantCtx, transcribeRequest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('MISSING_KEY');
  });

  it('records usage on a successful transcribe', async () => {
    const ledger = makeLedger();
    const router = createVoiceRouter({
      providers: { elevenlabs: makeProvider('elevenlabs') },
      ledger,
    });
    const result = await router.transcribe(tenantCtx, transcribeRequest);
    expect(result.success).toBe(true);
    expect(ledger.assertWithinBudget).toHaveBeenCalledWith('t1');
    expect(ledger.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        provider: 'elevenlabs',
        operation: 'voice.stt',
      }),
    );
  });

  it('falls back to the next provider on a retryable error', async () => {
    const failing = makeProvider('elevenlabs', {
      transcribe: async () =>
        vErr({
          code: 'RATE_LIMIT',
          message: 'slow down',
          provider: 'elevenlabs',
          retryable: true,
        }),
    });
    const ok = makeProvider('openai');
    const router = createVoiceRouter({
      providers: { elevenlabs: failing, openai: ok },
    });
    const result = await router.transcribe(tenantCtx, transcribeRequest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.providerId).toBe('openai');
  });

  it('aborts on a non-retryable error', async () => {
    const failing = makeProvider('elevenlabs', {
      transcribe: async () =>
        vErr({
          code: 'INVALID_AUDIO',
          message: 'bad audio',
          provider: 'elevenlabs',
          retryable: false,
        }),
    });
    const ok = vi.fn(async () =>
      vOk({
        text: 'fallback',
        language: 'en' as const,
        durationSec: 2,
        providerId: 'openai',
        model: 'openai-stt',
      }),
    );
    const router = createVoiceRouter({
      providers: {
        elevenlabs: failing,
        openai: makeProvider('openai', { transcribe: ok }),
      },
    });
    const result = await router.transcribe(tenantCtx, transcribeRequest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('INVALID_AUDIO');
    expect(ok).not.toHaveBeenCalled();
  });

  it('skips providers that do not support the requested language', async () => {
    const noSw = makeProvider('elevenlabs', {
      supportsLanguage: (lang) => lang !== 'sw',
    });
    const yesSw = makeProvider('openai', {
      supportsLanguage: (lang) => lang === 'sw',
    });
    const router = createVoiceRouter({
      providers: { elevenlabs: noSw, openai: yesSw },
    });
    const result = await router.transcribe(tenantCtx, {
      ...transcribeRequest,
      language: 'sw',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.providerId).toBe('openai');
  });

  it('does not crash when ledger.recordUsage throws', async () => {
    const ledger = makeLedger({
      recordUsage: vi.fn(async () => {
        throw new Error('ledger broken');
      }),
    });
    const router = createVoiceRouter({
      providers: { elevenlabs: makeProvider('elevenlabs') },
      ledger,
    });
    const result = await router.transcribe(tenantCtx, transcribeRequest);
    expect(result.success).toBe(true);
  });
});

describe('voice-router synthesize', () => {
  it('records usage with voice.tts operation on success', async () => {
    const ledger = makeLedger();
    const router = createVoiceRouter({
      providers: { elevenlabs: makeProvider('elevenlabs') },
      ledger,
    });
    const result = await router.synthesize(tenantCtx, synthesizeRequest);
    expect(result.success).toBe(true);
    expect(ledger.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'voice.tts' }),
    );
  });

  it('returns MISSING_KEY when no providers are configured', async () => {
    const router = createVoiceRouter({ providers: {} });
    const result = await router.synthesize(tenantCtx, synthesizeRequest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('MISSING_KEY');
  });

  it('falls back to second provider when first errors with retryable', async () => {
    const failing = makeProvider('elevenlabs', {
      synthesize: async () =>
        vErr({
          code: 'TIMEOUT',
          message: 'timeout',
          provider: 'elevenlabs',
          retryable: true,
        }),
    });
    const ok = makeProvider('openai');
    const router = createVoiceRouter({
      providers: { elevenlabs: failing, openai: ok },
    });
    const result = await router.synthesize(tenantCtx, synthesizeRequest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.providerId).toBe('openai');
  });
});
