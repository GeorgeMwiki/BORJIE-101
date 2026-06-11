/**
 * Dynamic model registry — L3 baseline constants.
 *
 * `MODELS` is the **last line of defence** in the 3-level resolver:
 *
 *     L1 in-memory TTL cache  →  L2 provider /v1/models  →  L3 MODELS
 *
 * Every family entry is guaranteed present and is always safe to return
 * synchronously from the hot path. When the provider is reachable, L2
 * may publish a newer id into the L1 cache; when the provider is down
 * or returns nothing, the resolver falls back here.
 *
 * Operator override per family via env var (uppercased + dashes → `_`):
 *
 *     BORJIE_MODEL_BASELINE_OPUS=claude-opus-4-8
 *     BORJIE_MODEL_BASELINE_GPT_5_MINI=gpt-5.4-mini
 *
 * The override is read at module-load time. Restart the process to
 * pick up a new value. (We intentionally do **not** re-read `env` on
 * every resolve — that's what the cache is for, and re-reading env
 * inside a hot path is an antipattern.)
 *
 * IMPORTANT: do not edit these baselines lightly. They are the
 * deterministic floor every caller falls back to when both the cache
 * and provider API are unavailable. Tracking the latest minor version
 * is the job of L2; this layer just guarantees a **valid** id.
 */

export const MODEL_FAMILIES = [
  'fable',
  'opus',
  'sonnet',
  'haiku',
  'gpt-5',
  'gpt-5-mini',
  'gpt-realtime',
  'whisper',
  'tts',
  'dall-e',
  'gemini-pro',
  'gemini-flash',
  'cohere-embed',
  'cohere-rerank',
  'eleven-tts',
  'eleven-stt',
  'deepseek-chat',
  'deepseek-coder',
] as const;

export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/**
 * Default baseline ids by family. Operator may override any entry via
 * `BORJIE_MODEL_BASELINE_<FAMILY_UPPER_UNDERSCORE>` env var.
 *
 * Conversion rule for env var names: uppercase, replace `-` with `_`.
 *   `opus`           → `BORJIE_MODEL_BASELINE_OPUS`
 *   `gpt-5-mini`     → `BORJIE_MODEL_BASELINE_GPT_5_MINI`
 *   `cohere-embed`   → `BORJIE_MODEL_BASELINE_COHERE_EMBED`
 */
export const MODELS: Readonly<Record<ModelFamily, string>> = Object.freeze({
  // Fable — the frontier Anthropic reasoning family. The DEEP (core
  // reasoning / thinking) tier resolves to the top of the capability rank,
  // which Fable currently leads (see FAMILY_CAPABILITY_RANK below). L2
  // `/v1/models` auto-publishes a newer `claude-fable-*` minor; a brand-new
  // superior family takes core reasoning by adding ONE rank entry or the
  // `BORJIE_ANTHROPIC_RANK` env — no call-site change.
  fable:
    process.env.BORJIE_MODEL_BASELINE_FABLE ?? 'claude-fable-5',
  opus:
    process.env.BORJIE_MODEL_BASELINE_OPUS ?? 'claude-opus-4-8',
  sonnet:
    process.env.BORJIE_MODEL_BASELINE_SONNET ?? 'claude-sonnet-4-6',
  haiku:
    process.env.BORJIE_MODEL_BASELINE_HAIKU ??
    'claude-haiku-4-5',
  'gpt-5':
    process.env.BORJIE_MODEL_BASELINE_GPT_5 ?? 'gpt-5.4',
  'gpt-5-mini':
    process.env.BORJIE_MODEL_BASELINE_GPT_5_MINI ?? 'gpt-5.4-mini',
  'gpt-realtime':
    process.env.BORJIE_MODEL_BASELINE_GPT_REALTIME ??
    'gpt-4o-realtime-preview-2025-06-03',
  whisper:
    process.env.BORJIE_MODEL_BASELINE_WHISPER ?? 'whisper-1',
  tts: process.env.BORJIE_MODEL_BASELINE_TTS ?? 'tts-1',
  'dall-e':
    process.env.BORJIE_MODEL_BASELINE_DALL_E ?? 'dall-e-3',
  'gemini-pro':
    process.env.BORJIE_MODEL_BASELINE_GEMINI_PRO ?? 'gemini-2.5-pro',
  'gemini-flash':
    process.env.BORJIE_MODEL_BASELINE_GEMINI_FLASH ??
    'gemini-2.5-flash',
  'cohere-embed':
    process.env.BORJIE_MODEL_BASELINE_COHERE_EMBED ?? 'embed-v4.0',
  'cohere-rerank':
    process.env.BORJIE_MODEL_BASELINE_COHERE_RERANK ?? 'rerank-3.5',
  'eleven-tts':
    process.env.BORJIE_MODEL_BASELINE_ELEVEN_TTS ?? 'eleven_v3',
  'eleven-stt':
    process.env.BORJIE_MODEL_BASELINE_ELEVEN_STT ?? 'scribe_v1',
  'deepseek-chat':
    process.env.BORJIE_MODEL_BASELINE_DEEPSEEK_CHAT ?? 'deepseek-chat',
  'deepseek-coder':
    process.env.BORJIE_MODEL_BASELINE_DEEPSEEK_CODER ??
    'deepseek-coder',
});

/** Runtime guard — true iff `value` is a known family. */
export function isModelFamily(value: unknown): value is ModelFamily {
  return (
    typeof value === 'string' &&
    (MODEL_FAMILIES as ReadonlyArray<string>).includes(value)
  );
}

// ───────────────────── Capability rank (single source) ─────────────────────
//
// Numeric capability rank — higher = more capable. THE canonical source of
// truth (min-tier-policy + the recommender import this; never re-declare).
// Sparse on purpose so a new tier slots in without renumbering. A new, more
// powerful Anthropic model is ONE line here (e.g. `mythos: 9`) — the deep
// (core-reasoning) tier then auto-promotes to it and the rest cascade down.
export const FAMILY_CAPABILITY_RANK: Readonly<
  Partial<Record<ModelFamily, number>>
> = Object.freeze({
  haiku: 1,
  'gpt-5-mini': 1,
  'gemini-flash': 1,
  'deepseek-chat': 1,
  sonnet: 3,
  'gpt-5': 3,
  'gemini-pro': 3,
  'deepseek-coder': 3,
  opus: 5,
  fable: 7,
});

/** Numeric capability rank for a family, or 0 if unranked. */
export function capabilityRankOf(family: ModelFamily): number {
  return FAMILY_CAPABILITY_RANK[family] ?? 0;
}

// ───────────── Rank-driven tier→family (intelligence-elasticity) ────────────
//
// The Claude reasoning deck the three tiers resolve to, ordered by capability
// at call time. The DEEP (core reasoning + thinking) tier is always the front
// of this rank; STANDARD is the next-most-capable; CHEAP is the floor. So a
// superior new Anthropic model — a `claude-fable-*` minor (auto via L2) or a
// brand-new family ranked above Fable — takes core reasoning automatically,
// and the rest go down in order of powerfulness, with ZERO call-site change.

const ANTHROPIC_REASONING_FAMILIES: ReadonlyArray<ModelFamily> = Object.freeze([
  'fable',
  'opus',
  'sonnet',
  'haiku',
]);

export type ReasoningTier = 'cheap' | 'standard' | 'deep';

/**
 * The Anthropic reasoning families ordered most-capable → least-capable.
 * Operator may reorder at RUNTIME (no redeploy) via `BORJIE_ANTHROPIC_RANK`
 * (comma-separated family list); unlisted known families append at the
 * bottom — a new family never silently seizes core reasoning, the promotion
 * is the single deliberate signal (rank line or env), honoring eval-gated
 * autonomy. Falls back to the canonical capability rank otherwise.
 */
export function rankedAnthropicFamilies(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ReadonlyArray<ModelFamily> {
  const override = env.BORJIE_ANTHROPIC_RANK?.trim();
  if (override) {
    const listed = override
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is ModelFamily => isModelFamily(s));
    if (listed.length > 0) {
      const rest = ANTHROPIC_REASONING_FAMILIES.filter(
        (f) => !listed.includes(f),
      );
      return Object.freeze([...listed, ...rest]);
    }
  }
  return Object.freeze(
    [...ANTHROPIC_REASONING_FAMILIES].sort(
      (a, b) => capabilityRankOf(b) - capabilityRankOf(a),
    ),
  );
}

const DEFAULT_TIER_RANK_INDEX: Readonly<Record<ReasoningTier, number>> =
  Object.freeze({ deep: 0, standard: 1, cheap: -1 });

/**
 * Resolve the Anthropic family for a reasoning tier by capability rank.
 *   deep     → rank[0]      (the most capable — core reasoning + thinking)
 *   standard → rank[1]      (the next most capable)
 *   cheap    → rank[last]   (the floor)
 * Per-tier position is operator-tunable via `BORJIE_TIER_RANK_<TIER>` (a rank
 * index; negative counts from the end) without touching code.
 */
export function tierFamilyByCapability(
  tier: ReasoningTier,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ModelFamily {
  const ranked = rankedAnthropicFamilies(env);
  const envIdx = env[`BORJIE_TIER_RANK_${tier.toUpperCase()}`]?.trim();
  const rawIdx =
    envIdx && Number.isFinite(Number(envIdx))
      ? Number(envIdx)
      : DEFAULT_TIER_RANK_INDEX[tier];
  const pos = rawIdx < 0 ? ranked.length + rawIdx : rawIdx;
  const clamped = Math.max(0, Math.min(pos, ranked.length - 1));
  return ranked[clamped] ?? ranked[0] ?? 'opus';
}
