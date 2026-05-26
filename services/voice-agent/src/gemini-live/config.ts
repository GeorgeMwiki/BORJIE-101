/**
 * Configuration shape for the Gemini Live provider.
 *
 * Required env:
 *   GEMINI_API_KEY        — Google AI API key. Missing key → stub mode.
 *
 * Optional env:
 *   GEMINI_VOICE_MODEL    — model id, defaults to gemini-2.5-flash-preview-native-audio.
 *   GEMINI_LIVE_BASE_URL  — override for testing; defaults to the
 *                           public Gemini Live WebSocket endpoint.
 *
 * No I/O happens here; this is config-shape + readers only. The shared
 * `_runtime.ts` `readEnv()` helper is used so missing keys flip to undefined.
 *
 * Per `~/.claude/rules/coding-style.md` we never mutate the returned config —
 * `loadConfig()` builds a fresh object every call.
 */

import { readEnv } from '../providers/_runtime.js';

/**
 * Default model id. Native-audio Gemini Live variant; 16 kHz in, 24 kHz out.
 * Kept here (not inlined) so tests + ops docs can read the same constant.
 */
export const DEFAULT_GEMINI_VOICE_MODEL =
  'gemini-2.5-flash-preview-native-audio';

/** Public Gemini Live WebSocket base. Override via env for staging tests. */
export const DEFAULT_GEMINI_LIVE_BASE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/**
 * Hard latency ceiling (voice-to-voice) before we trip the circuit breaker
 * and demote to the secondary tier. See spec §4 (Fallback chain).
 */
export const GEMINI_LIVE_LATENCY_BUDGET_MS = 1200;

/** Required env vars — exported for ops / CI secret-scan integration. */
export const GEMINI_LIVE_ENV_VARS = ['GEMINI_API_KEY'] as const;

/**
 * Resolved Gemini Live configuration. All fields are readonly so callers
 * cannot mutate the config object after construction.
 */
export interface GeminiLiveConfig {
  readonly apiKey: string | undefined;
  readonly model: string;
  readonly baseUrl: string;
  readonly latencyBudgetMs: number;
}

/**
 * Read config lazily from `process.env`. Returns a fresh object each call so
 * tests can override individual env vars between runs without leaking state.
 */
export function loadConfig(): GeminiLiveConfig {
  return {
    apiKey: readEnv('GEMINI_API_KEY'),
    model: readEnv('GEMINI_VOICE_MODEL') ?? DEFAULT_GEMINI_VOICE_MODEL,
    baseUrl: readEnv('GEMINI_LIVE_BASE_URL') ?? DEFAULT_GEMINI_LIVE_BASE_URL,
    latencyBudgetMs: GEMINI_LIVE_LATENCY_BUDGET_MS,
  };
}

/** True iff the API key is present — caller falls back to stub semantics otherwise. */
export function isGeminiLiveLive(config: GeminiLiveConfig): boolean {
  return config.apiKey !== undefined;
}
