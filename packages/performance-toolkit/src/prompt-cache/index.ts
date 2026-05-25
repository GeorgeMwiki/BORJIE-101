/**
 * Prompt-cache barrel — Anthropic ephemeral cache_control helpers.
 */

export {
  cachedSystemPrompt,
  splitForPromptCache,
  estimatePromptCacheSavings,
} from './cached-system-prompt.js';
export type {
  CachedSystemPromptInput,
  SplitForPromptCacheInput,
  SplitForPromptCacheResult,
} from './cached-system-prompt.js';
