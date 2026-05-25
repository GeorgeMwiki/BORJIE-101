/**
 * @borjie/content-studio — public types.
 *
 * Multi-modal generation surface: image / video / voice. Provider-agnostic
 * requests resolve to a specific backend through `router.ts` based on
 * (taskType, tenantTier, costBudget). Every result carries a C2PA-style
 * provenance manifest so downstream consumers (estate-manager-app,
 * marketing-brain, owner reports) can render "AI-generated" badges and
 * tenants can audit what was synthesized on their behalf.
 *
 * See research report:
 *   .audit/litfin-sota-2026-05-23/14-multimodal-generative.md
 *
 * Vendor docs cited:
 *   - https://bfl.ai/models/flux-pro-ultra
 *   - https://ai.google.dev/gemini-api/docs/image-generation
 *   - https://aistudio.google.com/models/veo-3
 *   - https://elevenlabs.io/v3
 *   - https://spitch.app/
 *   - https://lelapa.ai/products/vulavula/
 *
 * Pure contracts. No runtime here.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Modality + tier
// ─────────────────────────────────────────────────────────────────────

export const CONTENT_MODALITIES = ['image', 'video', 'voice'] as const;
export type ContentModality = (typeof CONTENT_MODALITIES)[number];

export const TENANT_TIERS = ['starter', 'pro', 'premium', 'enterprise'] as const;
export type TenantTier = (typeof TENANT_TIERS)[number];

export const COST_BUDGETS = ['cheap', 'balanced', 'premium'] as const;
export type CostBudget = (typeof COST_BUDGETS)[number];

// ─────────────────────────────────────────────────────────────────────
// Image task taxonomy
// ─────────────────────────────────────────────────────────────────────

export const IMAGE_TASKS = [
  'hero_photoreal',       // Flux Pro Ultra / Imagen 4 Ultra
  'text_in_image',        // Ideogram 3.0 — placards, brochures
  'vector_brand',         // Recraft V3 — logos, icons
  'conversational_edit',  // Nano Banana — "remove the car"
  'self_hosted_brand',    // SDXL+LoRA — data-sovereign tenants
] as const;
export type ImageTask = (typeof IMAGE_TASKS)[number];

// ─────────────────────────────────────────────────────────────────────
// Video task taxonomy
// ─────────────────────────────────────────────────────────────────────

export const VIDEO_TASKS = [
  'sizzle_reel',          // Veo 3.1 default
  'fast_social_cut',      // Runway Gen-4 Turbo
  'i2v_walkthrough',      // image -> video (Veo / Runway)
] as const;
export type VideoTask = (typeof VIDEO_TASKS)[number];

// ─────────────────────────────────────────────────────────────────────
// Voice task taxonomy + language routing
// ─────────────────────────────────────────────────────────────────────

export const VOICE_TASKS = ['narration', 'agent_realtime'] as const;
export type VoiceTask = (typeof VOICE_TASKS)[number];

/**
 * BCP-47 style language tags. Open string — providers advertise support
 * via `supportsLanguage()`; the language router decides which one wins.
 */
export type LanguageTag = string;

// ─────────────────────────────────────────────────────────────────────
// Brand profile — per-tenant brand metadata that conditions output
// ─────────────────────────────────────────────────────────────────────

export const BrandProfileSchema = z.object({
  tenantId: z.string(),
  brandName: z.string(),
  primaryColorOklch: z.string(),  // e.g. "oklch(0.55 0.18 240)"
  secondaryColorOklch: z.string().optional(),
  fontFamilyHeading: z.string(),
  fontFamilyBody: z.string(),
  photoStyle: z.enum(['editorial', 'candid', 'cinematic', 'minimal']).optional(),
  /** Per-tenant LoRA refs (Flux/SDXL). Training is offline; see lora-registry. */
  loraIds: z.array(z.string()).default([]),
  /** Recraft brand-library style id for vector outputs. */
  recraftStyleId: z.string().optional(),
  /** Voice clone id (ElevenLabs). */
  elevenLabsVoiceId: z.string().optional(),
});

export type BrandProfile = z.infer<typeof BrandProfileSchema>;

// ─────────────────────────────────────────────────────────────────────
// Request shapes — discriminated by modality
// ─────────────────────────────────────────────────────────────────────

export interface BaseRequest {
  readonly tenantId: string;
  readonly tenantTier: TenantTier;
  readonly costBudget?: CostBudget;
  readonly brand?: BrandProfile;
  readonly correlationId?: string;
}

export interface ImageRequest extends BaseRequest {
  readonly modality: 'image';
  readonly task: ImageTask;
  readonly prompt: string;
  readonly aspectRatio?: '1:1' | '4:3' | '16:9' | '9:16' | '3:4';
  readonly count?: number;       // default 1
  readonly seed?: number;
}

export interface ImageEditRequest extends BaseRequest {
  readonly modality: 'image';
  readonly task: 'conversational_edit';
  readonly sourceUrl: string;
  readonly editPrompt: string;
  readonly maskUrl?: string;
}

export interface VideoRequest extends BaseRequest {
  readonly modality: 'video';
  readonly task: VideoTask;
  readonly prompt: string;
  readonly durationSeconds: number;
  readonly aspectRatio: '16:9' | '9:16';
  readonly sourceImageUrl?: string;  // for i2v
}

export interface VoiceRequest extends BaseRequest {
  readonly modality: 'voice';
  readonly task: VoiceTask;
  readonly text: string;
  readonly language: LanguageTag;
  readonly voiceId?: string;
  readonly emotion?: 'neutral' | 'warm' | 'firm' | 'cheerful';
}

export type ContentRequest = ImageRequest | ImageEditRequest | VideoRequest | VoiceRequest;

// ─────────────────────────────────────────────────────────────────────
// Result shape
// ─────────────────────────────────────────────────────────────────────

export interface ContentAsset {
  readonly url: string;
  readonly mimeType: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly durationSeconds?: number;
  readonly sizeBytes?: number;
}

export interface ContentResult {
  readonly providerId: string;
  readonly modelId: string;
  readonly modality: ContentModality;
  readonly assets: ReadonlyArray<ContentAsset>;
  readonly costMicrousd: number;
  readonly c2paManifest: C2paManifest;
  readonly createdAtIso: string;
}

// ─────────────────────────────────────────────────────────────────────
// C2PA-style manifest — embedded provenance for AI-generated content
// ─────────────────────────────────────────────────────────────────────

export interface C2paAssertion {
  readonly label: string;
  readonly data: Record<string, unknown>;
}

export interface C2paIngredient {
  readonly title: string;
  readonly format: string;
  readonly hashSha256: string;
  readonly relationship: 'parentOf' | 'componentOf' | 'inputTo';
}

export interface C2paManifest {
  readonly claimGenerator: string;          // e.g. "borjie.content-studio/0.1"
  readonly claimGeneratorInfo: ReadonlyArray<{ name: string; version: string }>;
  readonly title: string;
  readonly format: string;                  // mime
  readonly instanceId: string;              // uuid-ish
  readonly assertions: ReadonlyArray<C2paAssertion>;
  readonly ingredients: ReadonlyArray<C2paIngredient>;
  readonly claimSignature: string;          // placeholder; real signing is external
  readonly signedAtIso: string;
}

// ─────────────────────────────────────────────────────────────────────
// Provider interfaces
// ─────────────────────────────────────────────────────────────────────

export interface ImageProvider {
  readonly providerId: string;
  readonly supportedTasks: ReadonlyArray<ImageTask>;
  generate(req: ImageRequest): Promise<ContentResult>;
  edit?(req: ImageEditRequest): Promise<ContentResult>;
}

export interface VideoProvider {
  readonly providerId: string;
  readonly supportedTasks: ReadonlyArray<VideoTask>;
  generate(req: VideoRequest): Promise<ContentResult>;
}

export interface VoiceProvider {
  readonly providerId: string;
  readonly supportedTasks: ReadonlyArray<VoiceTask>;
  synthesize(req: VoiceRequest): Promise<ContentResult>;
  supportsLanguage(lang: LanguageTag): boolean;
}
