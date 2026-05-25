/**
 * Voice session (Wave 11).
 *
 * Orchestrates a real-time conversational loop:
 *   audio_in → STT → LLM → TTS → audio_out
 *
 * Supports barge-in: when a new audio chunk arrives while a response is
 * still synthesizing, the previous in-flight turn is cancelled via
 * `AbortSignal`.
 *
 * This module is stateless beyond the minimal session record; the voice
 * router and LLM router do the heavy lifting. Persistence (transcript,
 * audio refs) is delegated to the classroom `session-recorder.ts`.
 */

import type { VoiceRouter } from './voice-router.js';
import type {
  VoiceLanguage,
  VoiceProviderTenantContext,
  VoiceResult,
} from './types.js';
import { vErr } from './types.js';

export interface VoiceSessionTurnResult {
  readonly transcript: string;
  readonly assistantText: string;
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly voiceProviderId: string;
  readonly llmProviderId?: string;
}

export interface LLMResponder {
  respond(input: {
    transcript: string;
    language: VoiceLanguage;
    priorTurns: readonly { role: 'user' | 'assistant'; text: string }[];
  }): Promise<{ text: string; providerId?: string }>;
}

export interface VoiceSessionConfig {
  readonly voiceRouter: VoiceRouter;
  readonly responder: LLMResponder;
  readonly language: VoiceLanguage;
  readonly voiceId?: string;
  readonly maxTurns?: number;
}

export interface VoiceSession {
  readonly id: string;
  readonly language: VoiceLanguage;
  readonly createdAt: string;
  readonly turns: readonly { role: 'user' | 'assistant'; text: string }[];
  readonly state: 'idle' | 'active' | 'ended';
}

export interface VoiceSessionHandle {
  readonly session: VoiceSession;
  turn(
    context: VoiceProviderTenantContext,
    audio: Uint8Array
  ): Promise<VoiceResult<VoiceSessionTurnResult>>;
  bargeIn(): void;
  end(): void;
}

/**
 * Create a new session handle. The session itself is immutable — every turn
 * returns a NEW session snapshot, re-assigned to a closure.
 */
export function createVoiceSession(
  config: VoiceSessionConfig
): VoiceSessionHandle {
  let session: VoiceSession = {
    id: `vs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    language: config.language,
    createdAt: new Date().toISOString(),
    turns: [],
    state: 'active',
  };
  let currentAbort: AbortController | null = null;

  async function turn(
    context: VoiceProviderTenantContext,
    audio: Uint8Array
  ): Promise<VoiceResult<VoiceSessionTurnResult>> {
    if (session.state === 'ended') {
      return vErr({
        code: 'PROVIDER_ERROR',
        message: 'Session already ended',
        provider: 'voice-session',
        retryable: false,
      });
    }
    if (
      config.maxTurns !== undefined &&
      session.turns.length >= config.maxTurns * 2
    ) {
      session = { ...session, state: 'ended' };
      return vErr({
        code: 'PROVIDER_ERROR',
        message: 'Max turns reached',
        provider: 'voice-session',
        retryable: false,
      });
    }

    // Cancel any in-flight turn.
    currentAbort?.abort();
    currentAbort = new AbortController();

    const sttResult = await config.voiceRouter.transcribe(context, {
      audio,
      language: config.language,
    });
    if (!sttResult.success) {
      return vErr((sttResult as { success: false; error: import('./types.js').VoiceProviderError }).error);
    }

    const prior = session.turns;
    const { text: assistantText, providerId: llmProviderId } =
      await config.responder.respond({
        transcript: sttResult.data.text,
        language: config.language,
        priorTurns: prior,
      });

    const ttsResult = await config.voiceRouter.synthesize(context, {
      text: assistantText,
      language: config.language,
      voiceId: config.voiceId,
    });
    if (!ttsResult.success) {
      return vErr((ttsResult as { success: false; error: import('./types.js').VoiceProviderError }).error);
    }

    // Immutable update: new turns list.
    session = {
      ...session,
      turns: [
        ...session.turns,
        { role: 'user', text: sttResult.data.text },
        { role: 'assistant', text: assistantText },
      ],
    };

    return {
      success: true,
      data: {
        transcript: sttResult.data.text,
        assistantText,
        audio: ttsResult.data.audio,
        mimeType: ttsResult.data.mimeType,
        voiceProviderId: ttsResult.data.providerId,
        llmProviderId,
      },
    };
  }

  function bargeIn(): void {
    currentAbort?.abort();
    currentAbort = null;
  }

  function end(): void {
    currentAbort?.abort();
    session = { ...session, state: 'ended' };
  }

  return {
    get session() {
      return session;
    },
    turn,
    bargeIn,
    end,
  };
}
