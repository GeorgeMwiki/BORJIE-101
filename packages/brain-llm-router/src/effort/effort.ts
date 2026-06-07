/**
 * effort — per-thread reasoning-effort selector.
 *
 * Ported from LITFIN `src/core/chat/effort-resolver.ts`.
 *
 * A thread (chat / agent run) carries a `ReasoningEffort` knob: how hard the
 * brain should think on THIS turn. It maps to a model tier:
 *
 *   fast      → a cheap, low-latency model     (BORJIE_MODEL_FAST)
 *   standard  → the balanced default model      (BORJIE_MODEL_STANDARD)
 *   deep      → the strongest reasoning model    (BORJIE_MODEL_DEEP)
 *
 * Malformed / missing input coerces to `standard` — the safe middle. Env vars
 * override the canonical defaults so model upgrades propagate without code
 * changes. Pure module; the only `process.env` reads are guarded + treated as
 * config, consistent with the other selectors in this package.
 */

import type { ModelTier } from '../types.js';

export type ReasoningEffort = 'fast' | 'standard' | 'deep';

export const DEFAULT_EFFORT: ReasoningEffort = 'standard';

/** Canonical defaults — align with task-ladder's tier choices. */
const CANONICAL_MODEL_BY_EFFORT: Readonly<Record<ReasoningEffort, ModelTier>> = Object.freeze({
  fast: 'anthropic/claude-haiku-4-5',
  standard: 'anthropic/claude-sonnet-4-6',
  deep: 'anthropic/claude-opus-4-8',
});

const ENV_BY_EFFORT: Readonly<Record<ReasoningEffort, string>> = Object.freeze({
  fast: 'BORJIE_MODEL_FAST',
  standard: 'BORJIE_MODEL_STANDARD',
  deep: 'BORJIE_MODEL_DEEP',
});

/**
 * Coerce an unknown value into a `ReasoningEffort`. Returns `standard` when the
 * input is not one of the three valid tokens (case-insensitive, trimmed).
 */
export function coerceEffort(raw: unknown): ReasoningEffort {
  if (typeof raw !== 'string') return DEFAULT_EFFORT;
  const v = raw.trim().toLowerCase();
  if (v === 'fast' || v === 'standard' || v === 'deep') return v;
  return DEFAULT_EFFORT;
}

/**
 * Resolve an effort to a concrete model id. An env override (e.g.
 * `BORJIE_MODEL_DEEP`) wins over the canonical default when set + non-empty.
 */
export function resolveEffortModel(effort: ReasoningEffort): ModelTier {
  const envName = ENV_BY_EFFORT[effort];
  const override = process.env[envName];
  if (override && override.trim().length > 0) return override.trim();
  return CANONICAL_MODEL_BY_EFFORT[effort];
}

/**
 * One-shot: coerce raw input AND resolve its model. Convenient for route
 * handlers that take an untrusted `effort` field off the wire.
 */
export function selectEffort(raw: unknown): { effort: ReasoningEffort; model: ModelTier } {
  const effort = coerceEffort(raw);
  return { effort, model: resolveEffortModel(effort) };
}

/** Stable telemetry label (mirrors the effort token; kept for pivot stability). */
export function effortLabel(effort: ReasoningEffort): string {
  return effort;
}
