/**
 * Spitch — Nigeria-focused TTS (Yoruba, Igbo, Hausa, Nigerian-accented English). [STUB]
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§4)
 *   - Spitch: https://spitch.app/
 *
 * Env vars REQUIRED to wire the real backend (currently unused — stub):
 *   - SPITCH_API_KEY  — primary
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
export const REQUIRED_ENV_VAR = 'SPITCH_API_KEY';

const SUPPORTED: ReadonlyArray<VoiceTask> = ['narration', 'agent_realtime'];
const PROVIDER_ID = 'spitch';
const MODEL_ID = 'spitch-2026-q1';

const SUPPORTED_LANGS: ReadonlySet<string> = new Set(['yo', 'ig', 'ha', 'en-ng']);

export function createSpitchProvider(): VoiceProvider {
  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    supportsLanguage(lang: LanguageTag): boolean {
      const lower = lang.toLowerCase();
      if (SUPPORTED_LANGS.has(lower)) return true;
      const base = lower.split('-')[0] ?? '';
      return SUPPORTED_LANGS.has(base);
    },

    async synthesize(req: VoiceRequest): Promise<ContentResult> {
      warnStubInvocation(PROVIDER_ID, REQUIRED_ENV_VAR);
      const hash = deterministicHash(`${PROVIDER_ID}|${req.language}|${req.text}`);
      const url = `https://stub.borjie.local/spitch/${hash}.mp3`;
      const createdAtIso = new Date(0).toISOString();
      const cost = Math.max(1, Math.ceil(req.text.length / 1000)) * 45_000;
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
          title: 'Spitch synthesized audio',
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
