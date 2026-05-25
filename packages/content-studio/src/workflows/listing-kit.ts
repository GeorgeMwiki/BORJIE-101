/**
 * "One-tap listing kit" workflow.
 *
 * Composes existing providers into the marquee marketing flow:
 *
 *   phone photo URL
 *     → conversational restage (Nano Banana)
 *     → text caption baked into hero (Ideogram)
 *     → 9:16 sizzle reel (Veo 3.1)
 *     → narrated voiceover (ElevenLabs v3 in caller's language)
 *
 * Caller passes a router; the workflow stays provider-agnostic. Pure
 * orchestration — no I/O of its own beyond delegating to the router.
 *
 * Reference:
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md
 *     (§"15 property-management content workflows worth automating" #1)
 */

import type {
  BrandProfile,
  ContentResult,
  LanguageTag,
  TenantTier,
} from '../types.js';
import type { ContentRouter } from '../router.js';

export interface ListingKitInput {
  readonly tenantId: string;
  readonly tenantTier: TenantTier;
  readonly listingId: string;
  readonly phonePhotoUrl: string;
  readonly editPrompt: string;            // e.g. "stage as modern Swahili-coast living room"
  readonly captionText: string;           // overlay text e.g. "FOR RENT — KSh 80,000/mo"
  readonly reelPrompt: string;            // 8 s cinematic camera dolly
  readonly narrationText: string;
  readonly narrationLanguage: LanguageTag;
  readonly brand?: BrandProfile;
}

export interface ListingKit {
  readonly listingId: string;
  readonly stagedHero: ContentResult;
  readonly captionedBanner: ContentResult;
  readonly sizzleReel: ContentResult;
  readonly narration: ContentResult;
}

export async function generateListingKit(
  router: ContentRouter,
  input: ListingKitInput,
): Promise<ListingKit> {
  const common = {
    tenantId: input.tenantId,
    tenantTier: input.tenantTier,
    ...(input.brand !== undefined && { brand: input.brand }),
  } as const;

  const stagedHero = await router.execute({
    modality: 'image',
    task: 'conversational_edit',
    sourceUrl: input.phonePhotoUrl,
    editPrompt: input.editPrompt,
    ...common,
  });

  const captionedBanner = await router.execute({
    modality: 'image',
    task: 'text_in_image',
    prompt: `${input.editPrompt}. Overlay text: "${input.captionText}". Brand colours from tenant.`,
    aspectRatio: '1:1',
    ...common,
  });

  const sizzleReel = await router.execute({
    modality: 'video',
    task: 'sizzle_reel',
    prompt: input.reelPrompt,
    durationSeconds: 8,
    aspectRatio: '9:16',
    sourceImageUrl: stagedHero.assets[0]?.url ?? input.phonePhotoUrl,
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
    listingId: input.listingId,
    stagedHero,
    captionedBanner,
    sizzleReel,
    narration,
  };
}
