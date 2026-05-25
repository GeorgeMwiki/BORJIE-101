/**
 * Self-hosted SDXL / SD 3.5 (OSS fallback). [STUB]
 *
 * Used for data-sovereign tenants (corporate landlords that refuse cloud
 * uploads). Trains a per-tenant LoRA in 1–3 GPU-hours and serves through
 * ComfyUI on a tenant GPU box.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§1.9)
 *   - Stability AI: https://stability.ai/news-updates/introducing-stable-diffusion-3-5
 *   - ComfyDeploy: https://www.comfydeploy.com/
 *
 * Env vars REQUIRED to wire the real backend (currently unused — stub):
 *   - COMFY_DEPLOY_URL    — base URL of tenant ComfyDeploy instance
 *   - COMFY_DEPLOY_TOKEN  — bearer token for that instance
 *   - TENANT_GPU_LORA_DIR — local path to LoRA weights on the GPU box
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
export const REQUIRED_ENV_VAR = 'COMFY_DEPLOY_URL';

const SUPPORTED: ReadonlyArray<ImageTask> = ['self_hosted_brand', 'hero_photoreal'];
const PROVIDER_ID = 'sdxl-self-host';
const MODEL_ID = 'sd-3.5-large';

export function createSdxlSelfHostProvider(): ImageProvider {
  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    async generate(req: ImageRequest): Promise<ContentResult> {
      warnStubInvocation(PROVIDER_ID, REQUIRED_ENV_VAR);
      const loraTag = (req.brand?.loraIds ?? []).join(',') || 'no-lora';
      const hash = deterministicHash(`${PROVIDER_ID}|${req.prompt}|${loraTag}|${req.seed ?? 0}`);
      const url = `https://stub.borjie.local/sdxl/${hash}.png`;
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
        costMicrousd: 0, // self-hosted; cost is GPU-amortised
        c2paManifest: buildC2paManifest({
          title: 'Self-hosted SDXL image',
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
