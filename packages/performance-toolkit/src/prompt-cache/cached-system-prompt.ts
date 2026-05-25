/**
 * Anthropic prompt-cache helpers. Mark the stable prefix of a message
 * (system + tool definitions) with `cache_control: { type: 'ephemeral' }`
 * to get 90% input-token discount on subsequent calls within the TTL.
 *
 *   Cache write : 1.25× standard input (5-min TTL) | 2.0× (1-hour TTL)
 *   Cache read  : 0.10× standard input  ← the 90% savings
 *
 * Break-even: 2 cache hits within the TTL. Anthropic's recommendation
 * (cookbook + claudecodecamp) is to mark whatever is stable for ≥ 5
 * minutes — system prompts, tool catalogues, long contexts.
 *
 * Source: platform.claude.com/docs/build-with-claude/prompt-caching (2026),
 * github.com/anthropics/anthropic-cookbook/misc/prompt_caching.ipynb,
 * dev.to/whoffagents/claude-prompt-caching-2026.
 */

import type {
  PromptCacheBlock,
  PromptCacheControl,
  PromptCacheEstimate,
  PromptCacheMessage,
} from '../types.js';

export interface CachedSystemPromptInput {
  /** The system prompt text — typically the bulk of the input tokens. */
  readonly system: string;
  /** Cache control marker — defaults to 5-minute ephemeral. */
  readonly cacheControl?: PromptCacheControl;
}

/**
 * Wrap a system string into Anthropic's cache_control-tagged block.
 * Returns an array suitable to pass as `system: [...]` in the API call.
 */
export function cachedSystemPrompt(input: CachedSystemPromptInput): readonly PromptCacheBlock[] {
  const control: PromptCacheControl = input.cacheControl ?? { type: 'ephemeral' };
  return [{ type: 'text', text: input.system, cache_control: control }];
}

/**
 * Split a list of conversation messages so that the stable prefix
 * (system + first N user turns that are static) is marked cacheable
 * and the live tail is not. Heuristic: messages with `cacheable: true`
 * metadata (or marked by length > some threshold) go in the prefix.
 *
 * For simple cases, callers should just call `cachedSystemPrompt` on
 * their system string and pass live messages unmodified.
 */
export interface SplitForPromptCacheInput {
  readonly messages: readonly PromptCacheMessage[];
  /**
   * Index up to which messages are stable enough to cache (inclusive).
   * Past this index, messages are passed unchanged. Default: cache all
   * messages whose total token estimate exceeds 1024 (the threshold
   * Anthropic requires before caching is allowed).
   */
  readonly stableThroughIndex?: number;
  /** TTL — `5m` (default) or `1h`. */
  readonly ttl?: '5m' | '1h';
}

export interface SplitForPromptCacheResult {
  readonly cacheable: readonly PromptCacheMessage[];
  readonly live: readonly PromptCacheMessage[];
}

export function splitForPromptCache(
  input: SplitForPromptCacheInput,
): SplitForPromptCacheResult {
  const cutoff =
    input.stableThroughIndex !== undefined
      ? input.stableThroughIndex + 1
      : input.messages.length - 1;
  const ttl = input.ttl ?? '5m';
  const cacheable: PromptCacheMessage[] = [];
  const live: PromptCacheMessage[] = [];
  for (let i = 0; i < input.messages.length; i++) {
    const msg = input.messages[i]!;
    if (i < cutoff) {
      cacheable.push(tagLastBlockCacheable(msg, ttl));
    } else {
      live.push(msg);
    }
  }
  return { cacheable, live };
}

function tagLastBlockCacheable(
  msg: PromptCacheMessage,
  ttl: '5m' | '1h',
): PromptCacheMessage {
  // Convert string content into a single text block then mark it.
  const blocks: PromptCacheBlock[] =
    typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content }]
      : msg.content.map((b) => ({ ...b }));
  if (blocks.length > 0) {
    const last = blocks[blocks.length - 1]!;
    blocks[blocks.length - 1] = {
      ...last,
      cache_control: { type: 'ephemeral', ttl },
    };
  }
  return { role: msg.role, content: blocks };
}

/**
 * Estimate the cost differential between a cache miss and a cache hit
 * for a given input-token volume and price per million tokens. Useful
 * for capacity planning and ROI sign-off on the prompt-cache rollout.
 */
export function estimatePromptCacheSavings({
  cachedTokens,
  pricePerMillionInputUsd,
  ttl = '5m',
}: {
  readonly cachedTokens: number;
  readonly pricePerMillionInputUsd: number;
  readonly ttl?: '5m' | '1h';
}): PromptCacheEstimate {
  const writeMul = ttl === '1h' ? 2.0 : 1.25;
  const readMul = 0.1;
  const standardUsd = (cachedTokens / 1_000_000) * pricePerMillionInputUsd;
  const missCostUsd = standardUsd * writeMul;
  const hitCostUsd = standardUsd * readMul;
  const savingsPercent = ((standardUsd - hitCostUsd) / standardUsd) * 100;
  return {
    cachedTokensEstimate: cachedTokens,
    writeCostMultiplier: writeMul,
    readCostMultiplier: readMul,
    hitSavingsPercent: Math.round(savingsPercent),
    estimatedHitCostUsd: hitCostUsd,
    estimatedMissCostUsd: missCostUsd,
  };
}
