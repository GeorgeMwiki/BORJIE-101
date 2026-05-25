/**
 * Voice-first conversational agent.
 *
 * Pipeline:
 *   1. Budget guard.
 *   2. Resolve customer context from caller phone (existing resolver port).
 *   3. STT via port (skip if transcript already supplied). If STT missing
 *      AND no transcript, return VOICE_NOT_CONFIGURED.
 *   4. Language detection — prefer STT output; fall back to LLM heuristic.
 *   5. Dispatch to VoiceBrainPort with voice-tone overrides + tool support.
 *   6. TTS via port (skip if not configured — still return the text reply
 *      in a degraded mode).
 *   7. Persist VoiceTurnRow with full audit metadata.
 *
 * Degraded mode = STT or TTS missing. The turn still flows; the response
 * carries `degradedMode: true` so UIs can surface a banner.
 */

import type { CostLedger } from '../../cost-ledger.js';
import { assertBudget, recordAiUsage } from '../phl-common/budget.js';
import {
  generateId,
  promptHashDjb2,
  type AiNativeResult,
} from '../phl-common/types.js';
import type {
  CustomerResolverPort,
  VoiceBrainPort,
  VoiceSttPort,
  VoiceTtsPort,
  VoiceTurnInput,
  VoiceTurnRepository,
  VoiceTurnResult,
  VoiceTurnRow,
} from './types.js';

export interface VoiceAgentDeps {
  readonly ledger?: CostLedger;
  readonly brain: VoiceBrainPort;
  readonly stt?: VoiceSttPort | null;
  readonly tts?: VoiceTtsPort | null;
  readonly resolveCustomer?: CustomerResolverPort;
  readonly repo: VoiceTurnRepository;
  readonly now?: () => Date;
}

export interface VoiceAgent {
  turn(input: VoiceTurnInput): Promise<AiNativeResult<VoiceTurnResult>>;
}

/**
 * Ultra-light heuristic language detector for when STT didn't set one and
 * the LLM port hasn't either. Not a replacement for proper detection —
 * this is a last-resort fallback so we never block on missing language.
 */
function heuristicDetect(text: string): string {
  const lower = text.toLowerCase();
  // Swahili cues — common in the first wave of pilot markets but the
  // engine still accepts any ISO-639 code. This is a fallback only.
  if (/(habari|asante|karibu|nyumba|jambo)/.test(lower)) return 'sw';
  if (/\b(hola|gracias|por favor)\b/.test(lower)) return 'es';
  if (/\b(bonjour|merci|s'il vous plait)\b/.test(lower)) return 'fr';
  // Default to English as a last resort — NOT a hardcoded jurisdiction,
  // just a language-of-last-resort for the LLM to echo.
  return 'en';
}

export function createVoiceAgent(deps: VoiceAgentDeps): VoiceAgent {
  const now = deps.now ?? (() => new Date());

  return {
    async turn(input) {
      if (!input.tenantId || !input.sessionId) {
        return {
          success: false,
          code: 'VALIDATION',
          message: 'tenantId and sessionId are required',
        };
      }
      if (!input.audioUrl && !input.transcript) {
        return {
          success: false,
          code: 'VALIDATION',
          message: 'audioUrl or transcript is required',
        };
      }

      const budgetContext = {
        tenantId: input.tenantId,
        operation: 'ai-native.voice-agent.turn',
        correlationId: input.correlationId,
      };

      try {
        await assertBudget(deps, budgetContext);
      } catch (err) {
        if (
          err instanceof Error &&
          (err as { code?: string }).code === 'AI_BUDGET_EXCEEDED'
        ) {
          return {
            success: false,
            code: 'BUDGET_EXCEEDED',
            message: err.message,
          };
        }
        throw err;
      }

      const startedAt = now().getTime();

      // 2) Customer resolution (best-effort)
      let customerId: string | null = null;
      if (deps.resolveCustomer) {
        try {
          const res = await deps.resolveCustomer.resolve({
            tenantId: input.tenantId,
            phone: input.callerPhone,
          });
          customerId = res?.customerId ?? null;
        } catch {
          customerId = null;
        }
      }

      // 3) STT or inline transcript
      let transcript = input.transcript ?? '';
      let sttLanguage: string | null = input.detectedLanguage ?? null;
      let degradedMode = false;

      if (!transcript && input.audioUrl) {
        if (!deps.stt) {
          // Honor the "return structured VOICE_NOT_CONFIGURED" contract.
          return {
            success: false,
            code: 'VOICE_NOT_CONFIGURED',
            message: 'STT adapter is not configured for this environment',
          };
        }
        try {
          const sttRes = await deps.stt.transcribe({
            audioUrl: input.audioUrl,
            languageHint: input.detectedLanguage,
          });
          if (!sttRes) {
            return {
              success: false,
              code: 'VOICE_NOT_CONFIGURED',
              message: 'STT adapter returned no configuration',
            };
          }
          transcript = sttRes.transcript;
          sttLanguage = sttRes.detectedLanguage ?? sttLanguage;
        } catch (err) {
          return {
            success: false,
            code: 'UPSTREAM_ERROR',
            message: err instanceof Error ? err.message : 'STT failed',
          };
        }
      }

      // 4) Language detection — prefer STT / caller hint, else heuristic
      const detectedLanguage =
        sttLanguage && sttLanguage.trim() !== ''
          ? sttLanguage
          : heuristicDetect(transcript);

      // 5) Brain dispatch
      const promptStr = [
        `tenant:${input.tenantId}`,
        `session:${input.sessionId}`,
        `customer:${customerId ?? 'anonymous'}`,
        `lang:${detectedLanguage}`,
        `transcript:${transcript}`,
      ].join('\n');
      const hash = promptHashDjb2(promptStr);

      let brainResponse;
      try {
        brainResponse = await deps.brain.turn({
          tenantId: input.tenantId,
          customerId,
          sessionId: input.sessionId,
          userTranscript: transcript,
          languageCode: detectedLanguage,
          voiceTone: 'warm',
          promptHash: hash,
        });
      } catch (err) {
        return {
          success: false,
          code: 'UPSTREAM_ERROR',
          message: err instanceof Error ? err.message : 'brain dispatch failed',
        };
      }

      await recordAiUsage(deps, budgetContext, {
        provider: 'ai-native',
        model: brainResponse.modelVersion,
        inputTokens: brainResponse.inputTokens,
        outputTokens: brainResponse.outputTokens,
        costUsdMicro: brainResponse.costUsdMicro,
      });

      // 6) TTS (optional — degrade gracefully)
      let responseAudioRef: string | null = null;
      if (deps.tts) {
        try {
          const tts = await deps.tts.synthesize({
            text: brainResponse.text,
            languageCode: detectedLanguage,
            voiceTone: 'warm',
          });
          responseAudioRef = tts?.audioRef ?? null;
          if (!tts) degradedMode = true;
        } catch {
          responseAudioRef = null;
          degradedMode = true;
        }
      } else {
        degradedMode = true;
      }

      // 7) Persist
      const nowIso = now().toISOString();
      const turnIndex = await deps.repo.countBySession(
        input.tenantId,
        input.sessionId,
      );
      const latencyMs = now().getTime() - startedAt;

      const row: VoiceTurnRow = Object.freeze({
        id: generateId('vtn'),
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        customerId,
        turnIndex,
        detectedLanguage,
        inputTranscript: transcript,
        responseText: brainResponse.text,
        responseAudioRef,
        toolCalls: Object.freeze([...brainResponse.toolCalls]),
        degradedMode,
        modelVersion: brainResponse.modelVersion,
        promptHash: hash,
        latencyMs,
        createdAt: nowIso,
      });

      await deps.repo.insert(row);

      const result: VoiceTurnResult = {
        sessionId: row.sessionId,
        turnIndex: row.turnIndex,
        detectedLanguage: row.detectedLanguage,
        inputTranscript: row.inputTranscript,
        responseText: row.responseText,
        responseAudioRef: row.responseAudioRef,
        toolCalls: row.toolCalls,
        degradedMode: row.degradedMode,
        modelVersion: row.modelVersion,
        promptHash: row.promptHash,
        latencyMs: row.latencyMs,
        customerId: row.customerId,
      };

      return { success: true, data: result };
    },
  };
}
