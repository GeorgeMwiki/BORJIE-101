/**
 * Capability brain-tools — `mining.media.generate_video` / `generate_gif`.
 *
 * These EXTEND the existing media surface (`mining.media.generate_image` and
 * friends in `services/media-generation/brain-tools.ts`) with the real,
 * provider-abstracted `@borjie/media-engine` for the video + GIF modalities
 * the legacy SVG-only generators never covered. They do NOT duplicate the
 * image tool — image stays on its existing generator; only video + GIF are
 * added here, both backed by the engine's async provider ladder.
 *
 * Rails honoured (the engine enforces them; we surface them):
 *   - Prompt-safety gate (block ⇒ typed error, never silent).
 *   - Evidence-required for public/tier-2 kinds (the engine throws on an
 *     empty chain; we require ≥1 evidence id on these public kinds).
 *   - Approval posture: tier-2 artifacts come back `approvalState:'pending'`
 *     — the proposal sink surfaces them proposal-gated, NEVER auto-published.
 *   - Provenance: every artifact carries a watermark plan + C2PA digest.
 *   - No process.env reads — keys/budget/fetch arrive via the injected
 *     `MediaContextProvider` (bootstrap seam).
 *
 * The returned `data.body_base64` lets the chat renderer inline the bytes;
 * the artifact (with provenance + approval state) flows to the proposal sink.
 *
 * @module composition/modality-capability/media-tools
 */

import type { ToolHandler } from '@borjie/ai-copilot';
import type { MediaEngine, MediaArtifact, MediaRequest } from '@borjie/media-engine';
import type { MediaContextProvider } from './media-context.js';

export const MEDIA_VIDEO_TOOL_NAME = 'mining.media.generate_video';
export const MEDIA_GIF_TOOL_NAME = 'mining.media.generate_gif';

export interface MediaCapabilityToolsDeps {
  readonly engine: MediaEngine;
  readonly contextProvider: MediaContextProvider;
}

/** Convert engine bytes to base64 without coupling to Buffer at the type seam. */
function toBase64(body: Uint8Array): string {
  return Buffer.from(body).toString('base64');
}

function evidenceIdsFrom(params: Record<string, unknown>): ReadonlyArray<string> {
  const raw = params['evidence_ids'] ?? params['evidenceIds'];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  return [];
}

/** Build the shared MediaRequest from loose tool params. */
function toMediaRequest(
  params: Record<string, unknown>,
  kind: MediaRequest['kind'],
  tenantId: string,
): MediaRequest {
  const prompt = typeof params['prompt'] === 'string' ? (params['prompt'] as string) : '';
  const locale = params['locale'] === 'sw' ? 'sw' : 'en';
  const aspectRatio =
    typeof params['aspectRatio'] === 'string'
      ? (params['aspectRatio'] as MediaRequest['aspectRatio'])
      : undefined;
  const durationSec =
    typeof params['durationSec'] === 'number' ? (params['durationSec'] as number) : undefined;
  return {
    kind,
    tenantId,
    prompt,
    inputs: [],
    locale,
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(durationSec ? { durationSec } : {}),
    evidenceIds: evidenceIdsFrom(params),
  };
}

/** Shape an engine artifact into the tool's data payload (no secrets). */
function artifactData(artifact: MediaArtifact): Record<string, unknown> {
  return {
    kind: 'media' as const,
    artifactId: artifact.id,
    mediaKind: artifact.kind,
    modality: artifact.modality,
    format: artifact.format,
    aspectRatio: artifact.aspectRatio,
    body_base64: toBase64(artifact.body),
    byteLength: artifact.byteLength,
    providerId: artifact.providerId,
    approvalState: artifact.approvalState,
    provenance: {
      contentHash: artifact.provenance.contentHash,
      manifestDigest: artifact.provenance.manifestDigest,
      synthIdPresent: artifact.provenance.synthIdPresent,
      watermark: artifact.provenance.watermark,
      signer: artifact.provenance.signer,
    },
    evidence_ids: artifact.evidenceIds,
    costCents: artifact.costCents,
  };
}

function buildTool(
  toolName: string,
  mediaKind: MediaRequest['kind'],
  description: string,
  deps: MediaCapabilityToolsDeps,
): ToolHandler {
  return {
    name: toolName,
    description,
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        aspectRatio: { type: 'string', enum: ['1:1', '4:5', '9:16', '16:9', '21:9'] },
        durationSec: { type: 'number', description: 'Clip length in seconds.' },
        locale: { type: 'string', enum: ['en', 'sw'] },
        evidence_ids: {
          type: 'array',
          description: 'Evidence ids grounding the brief (required for public-facing media).',
        },
      },
    },
    async execute(params, context) {
      const tenantId =
        context.tenant && typeof context.tenant.tenantId === 'string'
          ? context.tenant.tenantId
          : '';
      if (!tenantId) {
        return { ok: false, error: 'media generation requires a tenant context' };
      }
      try {
        const request = toMediaRequest(params, mediaKind, tenantId);
        if (!request.prompt) {
          return { ok: false, error: 'media generation requires a non-empty prompt' };
        }
        const ctx = deps.contextProvider.contextFor(tenantId);
        const artifact = await deps.engine.generate(request, ctx);
        const evidence = artifact.evidenceIds.length > 0 ? artifact.evidenceIds.join(', ') : 'none';
        return {
          ok: true,
          data: artifactData(artifact),
          evidenceSummary:
            `Generated ${artifact.modality} (${artifact.format}, ${artifact.providerId}, ` +
            `${artifact.byteLength}B, state=${artifact.approvalState}); evidence [${evidence}]`,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

/**
 * Build the video + GIF capability tools. Returns BOTH so the composition
 * root registers them alongside (not replacing) the existing image tools.
 */
export function buildMediaCapabilityTools(
  deps: MediaCapabilityToolsDeps,
): ReadonlyArray<ToolHandler> {
  return [
    buildTool(
      MEDIA_VIDEO_TOOL_NAME,
      'investor_brand_video',
      'Generate a short investor / brand video from a natural-language brief via the ' +
        'provider-abstracted media engine. Returns watermarked, C2PA-stamped bytes. ' +
        'Public-facing: requires ≥1 evidence id and comes back pending owner approval.',
      deps,
    ),
    buildTool(
      MEDIA_GIF_TOOL_NAME,
      'neighbourhood_reel',
      'Generate a short looping GIF/reel from a natural-language brief. Returns ' +
        'watermarked, C2PA-stamped bytes; public-facing and approval-gated.',
      deps,
    ),
  ];
}
