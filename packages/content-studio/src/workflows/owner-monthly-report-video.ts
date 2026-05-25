/**
 * "Owner monthly report video" workflow.
 *
 * 30-second narrated portfolio summary for landlords. Composes:
 *
 *   - Veo 3.1 cinematic establishing shot
 *   - ElevenLabs v3 voice-over in the owner's preferred language
 *
 * The text summary itself is produced by `@borjie/marketing-brain`
 * upstream; this workflow only handles the audio/video synthesis.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md
 *     (§"15 property-management content workflows worth automating" #8)
 */

import type {
  BrandProfile,
  ContentResult,
  LanguageTag,
  TenantTier,
} from '../types.js';
import type { ContentRouter } from '../router.js';

export interface OwnerReportVideoInput {
  readonly tenantId: string;
  readonly tenantTier: TenantTier;
  readonly ownerId: string;
  readonly reportingMonth: string;          // e.g. "2026-04"
  readonly videoPrompt: string;             // visual brief
  readonly narrationText: string;           // brain-authored script
  readonly narrationLanguage: LanguageTag;
  readonly brand?: BrandProfile;
}

export interface OwnerReportVideo {
  readonly ownerId: string;
  readonly reportingMonth: string;
  readonly video: ContentResult;
  readonly narration: ContentResult;
}

export async function generateOwnerReportVideo(
  router: ContentRouter,
  input: OwnerReportVideoInput,
): Promise<OwnerReportVideo> {
  const common = {
    tenantId: input.tenantId,
    tenantTier: input.tenantTier,
    ...(input.brand !== undefined && { brand: input.brand }),
  } as const;

  const video = await router.execute({
    modality: 'video',
    task: 'sizzle_reel',
    prompt: input.videoPrompt,
    durationSeconds: 30,
    aspectRatio: '16:9',
    ...common,
  });

  const narration = await router.execute({
    modality: 'voice',
    task: 'narration',
    text: input.narrationText,
    language: input.narrationLanguage,
    emotion: 'warm',
    ...common,
  });

  return {
    ownerId: input.ownerId,
    reportingMonth: input.reportingMonth,
    video,
    narration,
  };
}
