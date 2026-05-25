/**
 * Ideogram 3.0 — best text-in-image (90–95% accuracy). [STUB]
 *
 * Used for "FOR RENT" placards, branded brochures, social posts with
 * legible KES/UGX/TZS prices.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§1.2)
 *   - Ideogram: https://ideogram.ai/features/3.0
 *
 * Env vars REQUIRED to wire the real backend (currently unused — stub):
 *   - IDEOGRAM_API_KEY  — direct Ideogram API
 *   - TOGETHER_API_KEY  — Together AI fallback
 *
 * Pricing: Turbo $0.03/img, Quality $0.09/img.
 */

import { buildC2paManifest } from '../../c2pa/attestation.js';
import { deterministicHash, warnStubInvocation } from '../shared.js';
import type {
  ContentResult,
  ImageProvider,
  ImageRequest,
  ImageTask,
} from '../../types.js';

/** Explicit marker so the router and operators can detect stubbed backends. */
export const STUB_PROVIDER = true;
/** Env var that would unlock a real implementation. */
export const REQUIRED_ENV_VAR = 'IDEOGRAM_API_KEY';

const SUPPORTED: ReadonlyArray<ImageTask> = ['text_in_image'];
const PROVIDER_ID = 'ideogram';
const MODEL_ID = 'ideogram-3.0-quality';

export function createIdeogramProvider(): ImageProvider {
  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    async generate(req: ImageRequest): Promise<ContentResult> {
      warnStubInvocation(PROVIDER_ID, REQUIRED_ENV_VAR);
      const hash = deterministicHash(`${PROVIDER_ID}|${req.prompt}|${req.seed ?? 0}`);
      const url = `https://stub.borjie.local/ideogram/${hash}.png`;
      const createdAtIso = new Date(0).toISOString();
      return {
        providerId: PROVIDER_ID,
        modelId: MODEL_ID,
        modality: 'image',
        assets: [
          {
            url,
            mimeType: 'image/png',
            widthPx: 1024,
            heightPx: 1024,
          },
        ],
        costMicrousd: 90_000,
        c2paManifest: buildC2paManifest({
          title: 'Ideogram generated image',
          format: 'image/png',
          providerId: PROVIDER_ID,
          modelId: MODEL_ID,
          prompt: req.prompt,
          tenantId: req.tenantId,
          seed: req.seed ?? 0,
          loraIds: req.brand?.loraIds ?? [],
          createdAtIso,
        }),
        createdAtIso,
      };
    },
  };
}
