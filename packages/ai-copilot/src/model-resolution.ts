/**
 * model-resolution.ts — the Intelligence-Elasticity seam for @borjie/ai-copilot.
 *
 * THE LAW (owner directive): no call site may pin a model id. Swapping the
 * brain to a smarter model must be ONE change at the composition root.
 * Every literal model id elsewhere in this package is a resistor.
 *
 * This module is therefore the ONLY place in @borjie/ai-copilot where
 * concrete model-id strings may appear. Call sites declare INTENT
 * (a tier label or legacy slot); the id comes from resolution:
 *
 *   1. The composition root MAY inject a tier→id map via
 *      `setModelTierMap()` / `setLegacyOpenAiModelMap()` (e.g. fed by the
 *      gateway's dynamic model registry).
 *   2. Absent injection, the frozen DEFAULT maps below resolve to EXACTLY
 *      today's production ids — zero runtime behavior change by default.
 *
 * Example composition-root wiring (gateway side — not done here):
 *
 *   import { setModelTierMap } from '@borjie/ai-copilot';
 *   import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
 *   setModelTierMap({
 *     cheap: getModelLatest('haiku'),
 *     standard: getModelLatest('sonnet'),
 *     deep: getModelLatest('opus'),
 *   });
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Claude reasoning tiers — the declarative datum each junior carries
// ─────────────────────────────────────────────────────────────────────

/** Mirrors central-intelligence kernel/model-tiering.ts `ModelTier`. */
export type ModelTierLabel = 'cheap' | 'standard' | 'deep';

/**
 * The rank-driven default reasoning deck (intelligence-elasticity): DEEP is
 * core reasoning + thinking — the front of the Anthropic capability rank,
 * which Fable leads today; STANDARD is the next-most-capable; CHEAP is the
 * floor. This is the un-wired FALLBACK; the composition root injects the
 * LIVE registry-resolved ids via `setModelTierMap` so a newer/superior model
 * (a `claude-fable-*` minor, or a family ranked above Fable) takes core
 * reasoning automatically. Change upgrades through the rank/registry, never
 * by edit-here drift.
 */
export const DEFAULT_TIER_MODEL_IDS = Object.freeze({
  cheap: 'claude-haiku-4-5',
  standard: 'claude-opus-4-8',
  deep: 'claude-fable-5',
} as const satisfies Record<ModelTierLabel, string>);

export type ModelTierMap = Readonly<Partial<Record<ModelTierLabel, string>>>;

const ModelTierMapSchema = z
  .object({
    cheap: z.string().min(1).optional(),
    standard: z.string().min(1).optional(),
    deep: z.string().min(1).optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────
// Legacy OpenAI slots — the ten pre-brain copilots + voice + registry
// ─────────────────────────────────────────────────────────────────────

export type LegacyOpenAiSlot = 'default' | 'vision' | 'transcribe' | 'tts';

export const DEFAULT_LEGACY_OPENAI_MODEL_IDS = Object.freeze({
  default: 'gpt-4-turbo-preview',
  vision: 'gpt-4-turbo',
  transcribe: 'gpt-4o-mini-transcribe',
  tts: 'gpt-4o-mini-tts',
} as const satisfies Record<LegacyOpenAiSlot, string>);

export type LegacyOpenAiModelMap = Readonly<
  Partial<Record<LegacyOpenAiSlot, string>>
>;

const LegacyOpenAiModelMapSchema = z
  .object({
    default: z.string().min(1).optional(),
    vision: z.string().min(1).optional(),
    transcribe: z.string().min(1).optional(),
    tts: z.string().min(1).optional(),
  })
  .strict();

/**
 * Static catalog ids for provider validation/cost catalogs
 * (OpenAIProvider.supportedModels, OPENAI_MODELS router constants).
 * Catalogs DESCRIBE what a provider accepts — they are not routing
 * decisions — but their literals still live here so the package has a
 * single model-id source.
 */
export const OPENAI_CATALOG_MODEL_IDS = Object.freeze({
  GPT_4_TURBO_PREVIEW: 'gpt-4-turbo-preview',
  GPT_4_TURBO: 'gpt-4-turbo',
  GPT_4: 'gpt-4',
  GPT_4_32K: 'gpt-4-32k',
  GPT_3_5_TURBO: 'gpt-3.5-turbo',
  GPT_3_5_TURBO_16K: 'gpt-3.5-turbo-16k',
  GPT_4O: 'gpt-4o',
  GPT_4O_MINI: 'gpt-4o-mini',
} as const);

// ─────────────────────────────────────────────────────────────────────
// Injection seam (composition-root). Module-level rebinding only —
// the maps themselves are validated, copied, and frozen (no mutation).
// ─────────────────────────────────────────────────────────────────────

let injectedTierMap: ModelTierMap | undefined;
let injectedLegacyOpenAiMap: LegacyOpenAiModelMap | undefined;

/** Drop explicitly-undefined entries (exactOptionalPropertyTypes-safe). */
function compactDefined<K extends string>(
  parsed: Partial<Record<K, string | undefined>>,
): Readonly<Partial<Record<K, string>>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === 'string'),
    ) as Partial<Record<K, string>>,
  );
}

/** Inject (or clear, with `undefined`) the Claude tier→model-id map. */
export function setModelTierMap(map: ModelTierMap | undefined): void {
  injectedTierMap =
    map === undefined ? undefined : compactDefined(ModelTierMapSchema.parse(map));
}

/** Inject (or clear, with `undefined`) the legacy OpenAI slot→id map. */
export function setLegacyOpenAiModelMap(
  map: LegacyOpenAiModelMap | undefined,
): void {
  injectedLegacyOpenAiMap =
    map === undefined
      ? undefined
      : compactDefined(LegacyOpenAiModelMapSchema.parse(map));
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Resolve a Claude tier label to a concrete model id.
 * Precedence: per-call override → injected map → behavior-identical default.
 */
export function resolveTierModelId(
  tier: ModelTierLabel,
  mapOverride?: ModelTierMap,
): string {
  const candidate = (mapOverride ?? injectedTierMap)?.[tier];
  return nonEmpty(candidate) ? candidate : DEFAULT_TIER_MODEL_IDS[tier];
}

/**
 * Resolve a legacy OpenAI slot to a concrete model id.
 * Precedence: per-call override → injected map → behavior-identical default.
 */
export function resolveLegacyOpenAiModelId(
  slot: LegacyOpenAiSlot = 'default',
  mapOverride?: LegacyOpenAiModelMap,
): string {
  const candidate = (mapOverride ?? injectedLegacyOpenAiMap)?.[slot];
  return nonEmpty(candidate) ? candidate : DEFAULT_LEGACY_OPENAI_MODEL_IDS[slot];
}
