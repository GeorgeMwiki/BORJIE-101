/**
 * Normalise a ModelTier to a filesystem-safe cache key.
 *
 *   anthropic/claude-haiku-4-5@bedrock -> claude-haiku-4-5
 *   openai/gpt-5-pro                   -> gpt-5-pro
 *
 * Keeping this in its own file lets pricing.ts + prompt-cache.ts share the
 * same canonicalisation rule via a single import.
 */

import type { ModelTier } from '../types.js';

export function normaliseModelKey(model: ModelTier): string {
  const at = model.indexOf('@');
  const base = at === -1 ? model : model.slice(0, at);
  const slash = base.indexOf('/');
  return slash === -1 ? base : base.slice(slash + 1);
}
