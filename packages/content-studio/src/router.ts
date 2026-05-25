/**
 * Content-studio router.
 *
 * Picks the right provider for a given `ContentRequest` based on:
 *
 *   - modality          (image | video | voice)
 *   - task              (hero_photoreal, sizzle_reel, narration, …)
 *   - tenantTier        (starter | pro | premium | enterprise)
 *   - costBudget        (cheap | balanced | premium)
 *   - language          (voice only — Yoruba → Spitch, SA-Bantu → Lelapa, …)
 *
 * Mirrors the design of `@borjie/ai-copilot` multi-llm-router.ts: a
 * deterministic `pick()` and an `execute()` that walks the chain so a
 * provider blackout (no API key, throwing stub) falls through to the next
 * candidate. No global state.
 *
 * Reference:
 *   - Pattern: packages/ai-copilot/src/providers/multi-llm-router.ts
 *   - Research: .audit/litfin-sota-2026-05-23/14-multimodal-generative.md (§"Content Studio reference architecture")
 */

import type {
  ContentRequest,
  ContentResult,
  ImageEditRequest,
  ImageProvider,
  ImageRequest,
  ImageTask,
  TenantTier,
  VideoProvider,
  VideoRequest,
  VideoTask,
  VoiceProvider,
  VoiceRequest,
  VoiceTask,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Routing tables — most-specific-first per task. Each entry is a chain
// of provider IDs; the first one registered (and not blacklisted) wins.
// ─────────────────────────────────────────────────────────────────────

/**
 * Default chains — ordered most-preferred-first. Real providers (those
 * that ship a working `fetch` impl when their env var is set) lead the
 * chain so they win whenever the key is configured. Stubs trail so the
 * package still resolves a result when no keys exist (dev / CI without
 * secrets).
 *
 * Selection happens at `pick()` time against the providers actually
 * registered with the router. If a real provider isn't registered, the
 * chain naturally falls through to the next entry.
 */
const IMAGE_CHAINS_DEFAULT: Readonly<Record<ImageTask, ReadonlyArray<string>>> = {
  // OpenAI gpt-image-1 → real when OPENAI_API_KEY set; flux/sdxl trail.
  hero_photoreal:       ['openai-image', 'flux', 'sdxl-self-host'],
  // OpenAI also handles text-in-image reasonably; ideogram is the specialist fallback.
  text_in_image:        ['openai-image', 'ideogram'],
  vector_brand:         ['recraft'],
  conversational_edit: ['nano-banana'],
  self_hosted_brand:   ['sdxl-self-host'],
};

const VIDEO_CHAINS_DEFAULT: Readonly<Record<VideoTask, ReadonlyArray<string>>> = {
  sizzle_reel:      ['veo', 'runway'],
  fast_social_cut:  ['runway', 'veo'],
  i2v_walkthrough:  ['veo', 'runway'],
};

const VOICE_CHAINS_DEFAULT: Readonly<Record<VoiceTask, ReadonlyArray<string>>> = {
  narration:       ['elevenlabs', 'spitch', 'lelapa', 'cartesia'],
  agent_realtime:  ['cartesia', 'elevenlabs', 'spitch'],
};

/**
 * Tier-conditional gates. Self-hosted SDXL is reserved for enterprise +
 * premium tenants (data sovereignty). Free starter accounts get Cartesia
 * for any voice (cheapest) and Runway for any video.
 */
function tierAllowsProvider(tier: TenantTier, providerId: string): boolean {
  if (providerId === 'sdxl-self-host') {
    return tier === 'enterprise' || tier === 'premium';
  }
  if (providerId === 'veo' && tier === 'starter') {
    return false; // starter tenants don't get the premium video backend
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface ContentRouterDeps {
  readonly imageProviders: ReadonlyArray<ImageProvider>;
  readonly videoProviders: ReadonlyArray<VideoProvider>;
  readonly voiceProviders: ReadonlyArray<VoiceProvider>;
  /** Optional per-task chain overrides. */
  readonly imageChains?: Partial<Record<ImageTask, ReadonlyArray<string>>>;
  readonly videoChains?: Partial<Record<VideoTask, ReadonlyArray<string>>>;
  readonly voiceChains?: Partial<Record<VoiceTask, ReadonlyArray<string>>>;
}

export interface RouteDecision {
  readonly providerId: string;
  readonly reason: string;
}

export interface ContentRouter {
  pick(req: ContentRequest): RouteDecision | null;
  execute(req: ContentRequest): Promise<ContentResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createContentRouter(deps: ContentRouterDeps): ContentRouter {
  const imageById = byId(deps.imageProviders);
  const videoById = byId(deps.videoProviders);
  const voiceById = byId(deps.voiceProviders);

  const imageChains = { ...IMAGE_CHAINS_DEFAULT, ...(deps.imageChains ?? {}) };
  const videoChains = { ...VIDEO_CHAINS_DEFAULT, ...(deps.videoChains ?? {}) };
  const voiceChains = { ...VOICE_CHAINS_DEFAULT, ...(deps.voiceChains ?? {}) };

  function pickImage(req: ImageRequest | ImageEditRequest): RouteDecision | null {
    const chain = applyImageBudget(imageChains[req.task] ?? [], req.costBudget);
    for (const providerId of chain) {
      if (!tierAllowsProvider(req.tenantTier, providerId)) continue;
      const p = imageById.get(providerId);
      if (!p) continue;
      if (!p.supportedTasks.includes(req.task)) continue;
      if ('sourceUrl' in req && !p.edit) continue;
      return {
        providerId,
        reason: `image/${req.task} tier=${req.tenantTier} cost=${req.costBudget ?? 'balanced'}`,
      };
    }
    return null;
  }

  function pickVideo(req: VideoRequest): RouteDecision | null {
    const chain = applyVideoBudget(videoChains[req.task] ?? [], req.costBudget);
    for (const providerId of chain) {
      if (!tierAllowsProvider(req.tenantTier, providerId)) continue;
      const p = videoById.get(providerId);
      if (!p) continue;
      if (!p.supportedTasks.includes(req.task)) continue;
      return {
        providerId,
        reason: `video/${req.task} tier=${req.tenantTier} cost=${req.costBudget ?? 'balanced'}`,
      };
    }
    return null;
  }

  function pickVoice(req: VoiceRequest): RouteDecision | null {
    const chain = voiceChains[req.task] ?? [];
    for (const providerId of chain) {
      if (!tierAllowsProvider(req.tenantTier, providerId)) continue;
      const p = voiceById.get(providerId);
      if (!p) continue;
      if (!p.supportedTasks.includes(req.task)) continue;
      if (!p.supportsLanguage(req.language)) continue;
      return {
        providerId,
        reason: `voice/${req.task} lang=${req.language} tier=${req.tenantTier}`,
      };
    }
    return null;
  }

  function pick(req: ContentRequest): RouteDecision | null {
    if (req.modality === 'image') return pickImage(req);
    if (req.modality === 'video') return pickVideo(req);
    return pickVoice(req);
  }

  async function execute(req: ContentRequest): Promise<ContentResult> {
    const decision = pick(req);
    if (!decision) {
      throw new Error(
        `content-studio: no provider available for ${req.modality}/${'task' in req ? req.task : 'unknown'}`,
      );
    }
    if (req.modality === 'image') {
      const provider = imageById.get(decision.providerId);
      if (!provider) throw new Error(`provider missing: ${decision.providerId}`);
      if ('sourceUrl' in req) {
        if (!provider.edit) {
          throw new Error(`provider ${decision.providerId} does not support edit`);
        }
        return provider.edit(req);
      }
      return provider.generate(req);
    }
    if (req.modality === 'video') {
      const provider = videoById.get(decision.providerId);
      if (!provider) throw new Error(`provider missing: ${decision.providerId}`);
      return provider.generate(req);
    }
    const provider = voiceById.get(decision.providerId);
    if (!provider) throw new Error(`provider missing: ${decision.providerId}`);
    return provider.synthesize(req);
  }

  return { pick, execute };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — pure
// ─────────────────────────────────────────────────────────────────────

function byId<T extends { providerId: string }>(items: ReadonlyArray<T>): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of items) m.set(item.providerId, item);
  return m;
}

function applyImageBudget(
  chain: ReadonlyArray<string>,
  costBudget: ContentRequest['costBudget'],
): ReadonlyArray<string> {
  if (costBudget === 'cheap') {
    // Float self-hosted (zero marginal cost) to the head when present.
    const cheap = chain.filter((id) => id === 'sdxl-self-host');
    const rest = chain.filter((id) => id !== 'sdxl-self-host');
    return [...cheap, ...rest];
  }
  return chain;
}

function applyVideoBudget(
  chain: ReadonlyArray<string>,
  costBudget: ContentRequest['costBudget'],
): ReadonlyArray<string> {
  if (costBudget === 'cheap') {
    // Runway Turbo is the cheap option; float it ahead of Veo.
    const cheap = chain.filter((id) => id === 'runway');
    const rest = chain.filter((id) => id !== 'runway');
    return [...cheap, ...rest];
  }
  return chain;
}
