/**
 * Anthropic Prompt Prefix Cache — Phase D D4 (LLM cost reduction).
 *
 * Wraps the body the `AnthropicProvider` sends to `/v1/messages` with
 * Anthropic's `cache_control: { type: 'ephemeral' }` cache breakpoints.
 *
 * Reference: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 *
 * What Anthropic prompt caching does:
 *   - Marks a section of the request as cache-eligible. Subsequent
 *     requests sharing that prefix (verbatim, in order) read from the
 *     cache at ~10% of the input-token cost.
 *   - Cache breakpoints persist ~5 minutes (ephemeral) or longer
 *     (1h beta). Up to 4 breakpoints per request.
 *   - The cache hit covers everything UP TO and INCLUDING the marked
 *     block — system prompt + tool definitions + early historical
 *     messages are the prime targets.
 *
 * Our policy (priority order — only 4 blocks per request allowed):
 *   1. System prompt — ALWAYS marked when present. Highest ROI: the
 *      kernel system prompt is multi-thousand-token (persona, locus,
 *      memory, grounding, …) and identical across consecutive turns
 *      within a session.
 *   2. Tools array — marked when stable. The tool registry rarely
 *      changes mid-session.
 *   3. Long historical messages — marked when the message is > the
 *      `minStableHistoryTokens` threshold AND has been seen in a
 *      prior call (caller advertises stability via `stableHistoryHashes`).
 *
 * The function is PURE: takes an Anthropic request body, returns a
 * new body (immutable rewrite — never mutates the input). Safe to
 * call when no caching policy is wanted (`enabled: false` returns the
 * body unchanged).
 */

// ─────────────────────────────────────────────────────────────────────
// Anthropic shape (narrow — we only touch the fields we mutate)
// ─────────────────────────────────────────────────────────────────────

/** `cache_control` marker that Anthropic recognises. */
export type CacheControlMarker = { readonly type: 'ephemeral' };

export const EPHEMERAL_CACHE_MARKER: CacheControlMarker = Object.freeze({
  type: 'ephemeral',
});

/** A text content block as Anthropic accepts it for system / messages. */
export interface AnthropicTextBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: CacheControlMarker;
}

/** A tool definition as Anthropic accepts it. */
export interface AnthropicToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: unknown;
  readonly cache_control?: CacheControlMarker;
}

/** A message as Anthropic accepts it (string or block array content). */
export interface AnthropicMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | ReadonlyArray<AnthropicMessageBlock>;
}

export type AnthropicMessageBlock =
  | AnthropicTextBlock
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
      readonly cache_control?: CacheControlMarker;
    }
  | {
      readonly type: 'tool_result';
      readonly tool_use_id: string;
      readonly content: string | ReadonlyArray<AnthropicTextBlock>;
      readonly is_error?: boolean;
      readonly cache_control?: CacheControlMarker;
    };

export interface AnthropicRequestBody {
  readonly model?: string;
  readonly max_tokens?: number;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly system?: string | ReadonlyArray<AnthropicTextBlock>;
  readonly tools?: ReadonlyArray<AnthropicToolDef>;
  readonly messages: ReadonlyArray<AnthropicMessage | Record<string, unknown>>;
  readonly [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────
// Policy
// ─────────────────────────────────────────────────────────────────────

export interface PrefixCachePolicy {
  /** Master switch — `false` returns the body unmodified. Default true. */
  readonly enabled?: boolean;
  /**
   * Cap on `cache_control` breakpoints emitted. Anthropic enforces
   * max 4 per request. Default 4. We always prioritize system →
   * tools → historical messages.
   */
  readonly maxBreakpoints?: number;
  /**
   * Minimum estimated tokens for a historical message to qualify as a
   * cache breakpoint. Defaults to 1024 (Anthropic's recommended
   * minimum block size for caching to pay off).
   */
  readonly minStableHistoryTokens?: number;
  /**
   * Caller-supplied set of stable historical-message hashes. A message
   * whose content hash appears in this set is considered "seen before"
   * and eligible to receive a breakpoint. Empty / undefined → no
   * historical breakpoints applied (callers without state can still
   * benefit from system + tools caching).
   */
  readonly stableHistoryHashes?: ReadonlySet<string>;
  /**
   * Token-estimate function. Defaults to ~4 chars per token; callers
   * with access to a real tokenizer can plug in a precise one.
   */
  readonly estimateTokens?: (text: string) => number;
  /**
   * Content-hash function for stability check. Defaults to a tiny FNV-1a
   * 32-bit hash (collision-tolerant for the breakpoint heuristic).
   */
  readonly hashContent?: (text: string) => string;
}

export const DEFAULT_MAX_BREAKPOINTS = 4;
export const DEFAULT_MIN_STABLE_HISTORY_TOKENS = 1024;

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface PrefixCacheResult {
  readonly body: AnthropicRequestBody;
  readonly breakpointsApplied: number;
  readonly markedSystem: boolean;
  readonly markedTools: boolean;
  readonly markedHistoryIndices: ReadonlyArray<number>;
}

/**
 * Apply the prefix-cache policy to an Anthropic request body. Returns
 * a fresh body (the input is never mutated) plus a small report so
 * callers can log / telemetry-emit which blocks were marked.
 */
export function applyPrefixCache(
  body: AnthropicRequestBody,
  policy: PrefixCachePolicy = {},
): PrefixCacheResult {
  if (policy.enabled === false) {
    return {
      body,
      breakpointsApplied: 0,
      markedSystem: false,
      markedTools: false,
      markedHistoryIndices: [],
    };
  }
  const maxBreakpoints =
    policy.maxBreakpoints !== undefined && policy.maxBreakpoints >= 0
      ? Math.min(policy.maxBreakpoints, DEFAULT_MAX_BREAKPOINTS)
      : DEFAULT_MAX_BREAKPOINTS;
  if (maxBreakpoints === 0) {
    return {
      body,
      breakpointsApplied: 0,
      markedSystem: false,
      markedTools: false,
      markedHistoryIndices: [],
    };
  }
  const minTokens =
    policy.minStableHistoryTokens !== undefined &&
    policy.minStableHistoryTokens > 0
      ? policy.minStableHistoryTokens
      : DEFAULT_MIN_STABLE_HISTORY_TOKENS;
  const estimateTokens = policy.estimateTokens ?? defaultEstimateTokens;
  const hashContent = policy.hashContent ?? defaultHashContent;
  const stableHashes = policy.stableHistoryHashes ?? new Set<string>();

  let remaining = maxBreakpoints;
  let markedSystem = false;
  let markedTools = false;
  const markedHistoryIndices: number[] = [];

  // Build new body — start with a shallow clone.
  const out: { -readonly [K in keyof AnthropicRequestBody]: AnthropicRequestBody[K] } = {
    ...body,
  };

  // 1) System prompt — always first priority.
  if (body.system !== undefined && remaining > 0) {
    const marked = markSystem(body.system);
    if (marked) {
      out.system = marked;
      remaining -= 1;
      markedSystem = true;
    }
  }

  // 2) Tools array — second priority.
  if (Array.isArray(body.tools) && body.tools.length > 0 && remaining > 0) {
    const marked = markTools(body.tools);
    if (marked) {
      out.tools = marked;
      remaining -= 1;
      markedTools = true;
    }
  }

  // 3) Long historical messages — third priority, oldest-first.
  if (remaining > 0 && Array.isArray(body.messages) && body.messages.length > 0) {
    const { messages, markedIndices } = markHistoricalMessages({
      messages: body.messages as ReadonlyArray<AnthropicMessage>,
      remainingBreakpoints: remaining,
      minTokens,
      estimateTokens,
      hashContent,
      stableHashes,
    });
    if (markedIndices.length > 0) {
      out.messages = messages;
      remaining -= markedIndices.length;
      markedHistoryIndices.push(...markedIndices);
    }
  }

  return {
    body: out,
    breakpointsApplied: maxBreakpoints - remaining,
    markedSystem,
    markedTools,
    markedHistoryIndices,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Block markers
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a string-or-array system prompt to a block array with the
 * LAST block tagged `cache_control: ephemeral`. The marker covers
 * everything up to and including the tagged block.
 */
function markSystem(
  system: string | ReadonlyArray<AnthropicTextBlock>,
): ReadonlyArray<AnthropicTextBlock> | null {
  if (typeof system === 'string') {
    if (system.length === 0) return null;
    return [
      {
        type: 'text',
        text: system,
        cache_control: EPHEMERAL_CACHE_MARKER,
      },
    ];
  }
  if (!Array.isArray(system) || system.length === 0) return null;
  const cloned = system.map((b) => ({ ...b })) as AnthropicTextBlock[];
  const last = cloned[cloned.length - 1];
  if (!last) return null;
  cloned[cloned.length - 1] = {
    ...last,
    cache_control: EPHEMERAL_CACHE_MARKER,
  };
  return cloned;
}

/**
 * Tag the LAST tool def with `cache_control: ephemeral`. The marker
 * covers the entire tools array up to and including that def.
 */
function markTools(
  tools: ReadonlyArray<AnthropicToolDef>,
): ReadonlyArray<AnthropicToolDef> | null {
  if (tools.length === 0) return null;
  const cloned = tools.map((t) => ({ ...t }));
  const last = cloned[cloned.length - 1];
  if (!last) return null;
  cloned[cloned.length - 1] = {
    ...last,
    cache_control: EPHEMERAL_CACHE_MARKER,
  };
  return cloned;
}

interface MarkHistoryArgs {
  readonly messages: ReadonlyArray<AnthropicMessage>;
  readonly remainingBreakpoints: number;
  readonly minTokens: number;
  readonly estimateTokens: (text: string) => number;
  readonly hashContent: (text: string) => string;
  readonly stableHashes: ReadonlySet<string>;
}

/**
 * Walk the messages oldest→newest, marking the last text block of any
 * message whose content (a) exceeds `minTokens`, (b) is text-only, and
 * (c) has a content hash present in `stableHashes`. Returns a fresh
 * messages array plus the indices that were marked.
 *
 * The newest message (current user turn) is NEVER marked — caching it
 * would defeat the purpose, since the cache would only ever hit on the
 * NEXT turn that copy-pastes the same prompt.
 */
function markHistoricalMessages(args: MarkHistoryArgs): {
  readonly messages: ReadonlyArray<AnthropicMessage>;
  readonly markedIndices: ReadonlyArray<number>;
} {
  const messages = args.messages;
  if (messages.length <= 1 || args.remainingBreakpoints <= 0) {
    return { messages, markedIndices: [] };
  }
  const cloned: AnthropicMessage[] = messages.map((m) => ({ ...m }));
  const markedIndices: number[] = [];
  // Skip the final message — it's the current turn, not history.
  const lastIdx = cloned.length - 1;
  let remaining = args.remainingBreakpoints;
  for (let i = 0; i < lastIdx && remaining > 0; i += 1) {
    const msg = cloned[i];
    if (!msg) continue;
    const textContent = extractMessageText(msg);
    if (!textContent) continue;
    const tokens = args.estimateTokens(textContent);
    if (tokens < args.minTokens) continue;
    const hash = args.hashContent(textContent);
    if (!args.stableHashes.has(hash)) continue;
    // Promote to block-array form so we can tag.
    const blocks = toBlockArray(msg);
    if (blocks.length === 0) continue;
    const last = blocks[blocks.length - 1];
    if (!last || last.type !== 'text') continue;
    blocks[blocks.length - 1] = {
      ...last,
      cache_control: EPHEMERAL_CACHE_MARKER,
    };
    cloned[i] = { role: msg.role, content: blocks };
    markedIndices.push(i);
    remaining -= 1;
  }
  return { messages: cloned, markedIndices };
}

function extractMessageText(msg: AnthropicMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  const chunks: string[] = [];
  for (const block of msg.content) {
    if (block && (block as { type?: string }).type === 'text') {
      chunks.push(String((block as AnthropicTextBlock).text ?? ''));
    }
  }
  return chunks.join('\n');
}

function toBlockArray(msg: AnthropicMessage): AnthropicMessageBlock[] {
  if (typeof msg.content === 'string') {
    return [{ type: 'text', text: msg.content }];
  }
  if (!Array.isArray(msg.content)) return [];
  return msg.content.map((b) => ({ ...b })) as AnthropicMessageBlock[];
}

// ─────────────────────────────────────────────────────────────────────
// Defaults — token estimator + content hash
// ─────────────────────────────────────────────────────────────────────

/**
 * ~4 chars per token — accurate enough for the breakpoint heuristic.
 * Callers with access to `@anthropic-ai/tokenizer` should plug in a
 * real tokenizer for production telemetry.
 */
export function defaultEstimateTokens(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Tiny FNV-1a 32-bit hash, hex-encoded. Stable across processes; not
 * cryptographic — used only for "have I seen this string before?".
 */
export function defaultHashContent(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ─────────────────────────────────────────────────────────────────────
// Telemetry sink
// ─────────────────────────────────────────────────────────────────────

export interface PrefixCacheTelemetryEvent {
  readonly model: string;
  readonly breakpointsApplied: number;
  readonly markedSystem: boolean;
  readonly markedTools: boolean;
  readonly markedHistoryCount: number;
  readonly occurredAt: string;
}

export interface PrefixCacheTelemetrySink {
  record(event: PrefixCacheTelemetryEvent): Promise<void> | void;
}

/**
 * Convenience wrapper — apply the policy + emit a telemetry row.
 * Safe-by-default: telemetry failures are swallowed.
 */
export function applyPrefixCacheWithTelemetry(
  body: AnthropicRequestBody,
  policy: PrefixCachePolicy,
  sink?: PrefixCacheTelemetrySink,
  clock: () => Date = () => new Date(),
): PrefixCacheResult {
  const result = applyPrefixCache(body, policy);
  if (sink) {
    try {
      const ret = sink.record({
        model: typeof body.model === 'string' ? body.model : 'unknown',
        breakpointsApplied: result.breakpointsApplied,
        markedSystem: result.markedSystem,
        markedTools: result.markedTools,
        markedHistoryCount: result.markedHistoryIndices.length,
        occurredAt: clock().toISOString(),
      });
      if (ret && typeof (ret as Promise<void>).catch === 'function') {
        (ret as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* swallow */
    }
  }
  return result;
}
