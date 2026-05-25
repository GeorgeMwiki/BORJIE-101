/**
 * Cartesia Sonic-2 / Sonic-Turbo / Sonic-3 — lowest-latency realtime TTS. [STUB]
 *
 * 40 ms TTFB (Sonic-Turbo) — the snappiest barge-in for Mr. Mwikila's
 * inbound call agent.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§3.3)
 *   - Cartesia: https://docs.cartesia.ai/build-with-cartesia/tts-models/latest
 *
 * Env vars REQUIRED to wire the real backend (currently unused — stub):
 *   - CARTESIA_API_KEY  — primary
 */

import { buildC2paManifest } from '../../c2pa/attestation.js';
import { deterministicHash, warnStubInvocation } from '../shared.js';
import type {
  ContentResult,
  LanguageTag,
  VoiceProvider,
  VoiceRequest,
  VoiceTask,
} from '../../types.js';

/** Explicit marker so the router and operators can detect stubbed backends. */
export const STUB_PROVIDER = true;
/** Env var that would unlock a real implementation. */
export const REQUIRED_ENV_VAR = 'CARTESIA_API_KEY';

const SUPPORTED: ReadonlyArray<VoiceTask> = ['agent_realtime', 'narration'];
const PROVIDER_ID = 'cartesia';
const MODEL_ID = 'sonic-2';

const SUPPORTED_LANGS: ReadonlySet<string> = new Set([
  'en', 'fr', 'de', 'es', 'pt', 'it', 'ja', 'zh', 'ko',
]);

export function createCartesiaProvider(): VoiceProvider {
  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    supportsLanguage(lang: LanguageTag): boolean {
      const base = lang.toLowerCase().split('-')[0] ?? '';
      return SUPPORTED_LANGS.has(base);
    },

    async synthesize(req: VoiceRequest): Promise<ContentResult> {
      warnStubInvocation(PROVIDER_ID, REQUIRED_ENV_VAR);
      const hash = deterministicHash(`${PROVIDER_ID}|${req.language}|${req.text}`);
      const url = `https://stub.borjie.local/cartesia/${hash}.mp3`;
      const createdAtIso = new Date(0).toISOString();
      const cost = Math.max(1, Math.ceil(req.text.length / 1000)) * 38_000;
      return {
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        modality: 'voice',
        assets: [
          {
            url,
            mimeType: 'audio/mpeg',
            durationSeconds: Math.max(1, Math.ceil(req.text.length / 18)),
          },
        ],
        costMicrousd: cost,
        c2paManifest: buildC2paManifest({
          title: 'Cartesia synthesized audio',
          format: 'audio/mpeg',
          providerId: PROVIDER_ID,
          modelId: MODEL_ID,
          prompt: req.text,
          tenantId: req.tenantId,
          seed: 0,
          loraIds: [],
          createdAtIso,
        }),
        createdAtIso,
      };
    },
  };
}
