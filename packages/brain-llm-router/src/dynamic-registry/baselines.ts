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
 *     BORJIE_MODEL_BASELINE_OPUS=claude-opus-4-7
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
  opus:
    process.env.BORJIE_MODEL_BASELINE_OPUS ?? 'claude-opus-4-7',
  sonnet:
    process.env.BORJIE_MODEL_BASELINE_SONNET ?? 'claude-sonnet-4-6',
  haiku:
    process.env.BORJIE_MODEL_BASELINE_HAIKU ??
    'claude-haiku-4-5-20251001',
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
