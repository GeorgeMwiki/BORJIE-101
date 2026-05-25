/**
 * Nano Banana / Nano Banana Pro — Gemini 3 Pro Image Preview. [STUB]
 *
 * The workhorse for *conversational editing* of listing photos
 * (virtual staging, "remove the car"). Identity-preserving local edits.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§1.5)
 *   - Google docs: https://ai.google.dev/gemini-api/docs/image-generation
 *
 * Env vars REQUIRED to wire the real backend (currently unused — stub):
 *   - GEMINI_API_KEY  — Gemini API access
 *   - VERTEX_PROJECT  — optional Vertex AI alternative
 *
 * Pricing reference: $0.039 (2.5 Flash) → $0.134 (3 Pro Preview).
 */

import { buildC2paManifest } from '../../c2pa/attestation.js';
import { deterministicHash, warnStubInvocation } from '../shared.js';
import type {
  ContentResult,
  ImageEditRequest,
  ImageProvider,
  ImageRequest,
  ImageTask,
} from '../../types.js';

/** Explicit marker so the router and operators can detect stubbed backends. */
export const STUB_PROVIDER = true;
/** Env var that would unlock a real implementation. */
export const REQUIRED_ENV_VAR = 'GEMINI_API_KEY';

const SUPPORTED: ReadonlyArray<ImageTask> = ['conversational_edit'];
const PROVIDER_ID = 'nano-banana';
const MODEL_ID = 'gemini-3-pro-image-preview';

export function createNanoBananaProvider(): ImageProvider {
  return {
    providerId: PROVIDER_ID,
    supportedTasks: SUPPORTED,

    async generate(req: ImageRequest): Promise<ContentResult> {
      warnStubInvocation(PROVIDER_ID, REQUIRED_ENV_VAR);
      const hash = deterministicHash(`${PROVIDER_ID}|${req.prompt}|${req.seed ?? 0}`);
      const createdAtIso = new Date(0).toISOString();
      return synthResult({
        url: `https://stub.borjie.local/nano-banana/${hash}.png`,
        prompt: req.prompt,
        tenantId: req.tenantId,
        loraIds: req.brand?.loraIds ?? [],
        createdAtIso,
        ingredientHash: null,
      });
    },

    async edit(req: ImageEditRequest): Promise<ContentResult> {
      warnStubInvocation(PROVIDER_ID, REQUIRED_ENV_VAR);
      const hash = deterministicHash(`${PROVIDER_ID}|edit|${req.sourceUrl}|${req.editPrompt}`);
      const createdAtIso = new Date(0).toISOString();
      return synthResult({
        url: `https://stub.borjie.local/nano-banana-edit/${hash}.png`,
        prompt: req.editPrompt,
        tenantId: req.tenantId,
        loraIds: req.brand?.loraIds ?? [],
        createdAtIso,
        ingredientHash: deterministicHash(req.sourceUrl),
        ingredientUrl: req.sourceUrl,
      });
    },
  };
}

function synthResult(args: {
  url: string;
  prompt: string;
  tenantId: string;
  loraIds: ReadonlyArray<string>;
  createdAtIso: string;
  ingredientHash: string | null;
  ingredientUrl?: string;
}): ContentResult {
  const ingredients =
    args.ingredientHash && args.ingredientUrl
      ? [
          {
            title: args.ingredientUrl,
            format: 'image/*',
            hashSha256: args.ingredientHash,
            relationship: 'inputTo' as const,
          },
        ]
      : [];
  return {
    providerId: PROVIDER_ID,
    modelId: MODEL_ID,
    modality: 'image',
    assets: [
      {
        url: args.url,
        mimeType: 'image/png',
        widthPx: 1024,
        heightPx: 1024,
      },
    ],
    costMicrousd: 134_000,
    c2paManifest: buildC2paManifest({
      title: 'Nano Banana generated image',
      format: 'image/png',
      providerId: PROVIDER_ID,
      modelId: MODEL_ID,
      prompt: args.prompt,
      tenantId: args.tenantId,
      seed: 0,
      loraIds: args.loraIds,
      createdAtIso: args.createdAtIso,
      ingredients,
    }),
    createdAtIso: args.createdAtIso,
  };
}
