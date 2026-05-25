/**
 * Voice router (Wave 11).
 *
 * Picks the right voice provider per request given the language + available
 * providers. Rules:
 *
 *   Swahili or 'mixed' → ElevenLabs (OpenAI voice has weak Swahili quality).
 *   English            → ElevenLabs primary, OpenAI fallback.
 *
 * Fallback is automatic on retryable errors (rate-limit, 5xx, timeout).
 *
 * Every successful call is recorded to the cost ledger with a synthetic
 * token accounting so operators can reconcile spend per-tenant per-provider.
 */

import type { CostLedger } from '../cost-ledger.js';
import type {
  VoiceProvider,
  VoiceLanguage,
  TranscribeRequest,
  TranscribeResponse,
  SynthesizeRequest,
  SynthesizeResponse,
  VoiceResult,
  VoiceProviderError,
  VoiceProviderTenantContext,
} from './types.js';
import { vErr } from './types.js';

export interface VoiceRouterDeps {
  readonly providers: {
    readonly elevenlabs?: VoiceProvider;
    readonly openai?: VoiceProvider;
  };
  readonly ledger?: CostLedger;
  /**
   * Microdollar cost per second of audio (synthetic estimate). Used to keep
   * the ledger meaningful without paying full attention to byte-level costs.
   * Defaults: ~$0.0002/s elevenlabs, ~$0.00006/s openai.
   */
  readonly pricePerSecondMicro?: {
    readonly elevenlabs?: number;
    readonly openai?: number;
  };
}

export interface VoiceRouter {
  pickProvider(lang: VoiceLanguage): readonly string[];
  transcribe(
    context: VoiceProviderTenantContext,
    request: TranscribeRequest
  ): Promise<VoiceResult<TranscribeResponse>>;
  synthesize(
    context: VoiceProviderTenantContext,
    request: SynthesizeRequest
  ): Promise<VoiceResult<SynthesizeResponse>>;
}

export function createVoiceRouter(deps: VoiceRouterDeps): VoiceRouter {
  const { providers } = deps;
  const priceTable = {
    elevenlabs: deps.pricePerSecondMicro?.elevenlabs ?? 200,
    openai: deps.pricePerSecondMicro?.openai ?? 60,
  };

  function pickProvider(lang: VoiceLanguage): readonly string[] {
    if (lang === 'sw') {
      return ['elevenlabs', 'openai'].filter((p) =>
        Boolean(providers[p as 'elevenlabs' | 'openai'])
      );
    }
    // English or mixed — ElevenLabs first; OpenAI fallback.
    return ['elevenlabs', 'openai'].filter((p) =>
      Boolean(providers[p as 'elevenlabs' | 'openai'])
    );
  }

  async function recordVoiceUsage(
    context: VoiceProviderTenantContext,
    providerId: string,
    model: string,
    durationSec: number,
    operation: string
  ): Promise<void> {
    if (!deps.ledger) return;
    const rate =
      providerId === 'elevenlabs' ? priceTable.elevenlabs : priceTable.openai;
    const costUsdMicro = Math.max(0, Math.round(durationSec * rate));
    try {
      await deps.ledger.recordUsage({
        tenantId: context.tenantId,
        provider: providerId,
        model,
        inputTokens: 0,
        outputTokens: Math.ceil(durationSec),
        costUsdMicro,
        operation,
        correlationId: context.correlationId,
      });
    } catch {
      // do not fail the caller for accounting
    }
  }

  async function transcribe(
    context: VoiceProviderTenantContext,
    request: TranscribeRequest
  ): Promise<VoiceResult<TranscribeResponse>> {
    if (deps.ledger) {
      await deps.ledger.assertWithinBudget(context.tenantId);
    }
    const ids = pickProvider(request.language);
    if (ids.length === 0) {
      return vErr({
        code: 'MISSING_KEY',
        message: 'No voice provider configured',
        provider: 'voice-router',
        retryable: false,
      });
    }
    let last: VoiceProviderError | null = null;
    for (const id of ids) {
      const p = providers[id as 'elevenlabs' | 'openai'];
      if (!p) continue;
      if (!p.supportsLanguage(request.language)) continue;
      const r = await p.transcribe(request);
      if (r.success) {
        await recordVoiceUsage(
          context,
          p.providerId,
          r.data.model,
          r.data.durationSec,
          'voice.stt'
        );
        return r;
      }
      const err = (r as { success: false; error: VoiceProviderError }).error;
      last = err;
      if (!err.retryable) break;
    }
    return vErr(
      last ?? {
        code: 'PROVIDER_ERROR',
        message: 'No voice provider accepted the request',
        provider: 'voice-router',
        retryable: false,
      }
    );
  }

  async function synthesize(
    context: VoiceProviderTenantContext,
    request: SynthesizeRequest
  ): Promise<VoiceResult<SynthesizeResponse>> {
    if (deps.ledger) {
      await deps.ledger.assertWithinBudget(context.tenantId);
    }
    const ids = pickProvider(request.language);
    if (ids.length === 0) {
      return vErr({
        code: 'MISSING_KEY',
        message: 'No voice provider configured',
        provider: 'voice-router',
        retryable: false,
      });
    }
    let last: VoiceProviderError | null = null;
    for (const id of ids) {
      const p = providers[id as 'elevenlabs' | 'openai'];
      if (!p) continue;
      if (!p.supportsLanguage(request.language)) continue;
      const r = await p.synthesize(request);
      if (r.success) {
        // Synthesis duration is unknown server-side; approximate from chars.
        const approxSec = Math.max(1, Math.round(request.text.length / 16));
        await recordVoiceUsage(
          context,
          p.providerId,
          r.data.model,
          approxSec,
          'voice.tts'
        );
        return r;
      }
      const err = (r as { success: false; error: VoiceProviderError }).error;
      last = err;
      if (!err.retryable) break;
    }
    return vErr(
      last ?? {
        code: 'PROVIDER_ERROR',
        message: 'No voice provider accepted the request',
        provider: 'voice-router',
        retryable: false,
      }
    );
  }

  return { pickProvider, transcribe, synthesize };
}
