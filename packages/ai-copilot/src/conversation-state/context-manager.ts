/**
 * Context manager
 *
 * Rolling conversation context with smart compaction. As a conversation
 * grows, this module is responsible for deciding which past turns to keep
 * verbatim, which to summarise, and which to drop entirely.
 *
 * Strategy:
 *   1. Always keep the most recent N turns verbatim (default 12).
 *   2. Older turns get collapsed into a running \"digest\" string until the
 *      digest itself exceeds a token-budget heuristic.
 *   3. Extracted entities are preserved across compactions.
 */

import type { ConversationState, ConversationTurn } from './types.js';

export interface ContextSnapshot {
  readonly recentTurns: readonly ConversationTurn[];
  readonly digest: string;
  readonly entities: readonly ConversationState['entities'][number][];
  readonly tokenEstimate: number;
}

export interface ContextManagerOptions {
  readonly keepRecent?: number;
  readonly maxTokenBudget?: number;
}

const DEFAULT_KEEP_RECENT = 12;
const DEFAULT_MAX_TOKENS = 3_500;

export class ContextManager {
  private readonly opts: Required<ContextManagerOptions>;

  constructor(opts: ContextManagerOptions = {}) {
    this.opts = {
      keepRecent: opts.keepRecent ?? DEFAULT_KEEP_RECENT,
      maxTokenBudget: opts.maxTokenBudget ?? DEFAULT_MAX_TOKENS,
    };
  }

  snapshot(state: ConversationState): ContextSnapshot {
    const { history, entities } = state;
    if (history.length <= this.opts.keepRecent) {
      return {
        recentTurns: history,
        digest: '',
        entities,
        tokenEstimate: estimateTokens(
          history.map((t) => t.text).join(' ') ?? '',
        ),
      };
    }
    const recentTurns = history.slice(-this.opts.keepRecent);
    const older = history.slice(0, -this.opts.keepRecent);
    const digest = buildDigest(older);
    const tokenEstimate = estimateTokens(
      digest + ' ' + recentTurns.map((t) => t.text).join(' '),
    );

    // If we still blow the budget, truncate the digest line-by-line.
    const digestFitted =
      tokenEstimate > this.opts.maxTokenBudget
        ? truncateDigest(digest, this.opts.maxTokenBudget / 2)
        : digest;

    return {
      recentTurns,
      digest: digestFitted,
      entities,
      tokenEstimate: estimateTokens(
        digestFitted + ' ' + recentTurns.map((t) => t.text).join(' '),
      ),
    };
  }
}

function buildDigest(turns: readonly ConversationTurn[]): string {
  const lines = turns.map((t) => {
    const role = t.role === 'user' ? 'User' : 'Mwikila';
    const preview = t.text.slice(0, 120).replace(/\s+/g, ' ').trim();
    return `[${role}] ${preview}`;
  });
  return lines.join('\n');
}

function truncateDigest(digest: string, approxTokens: number): string {
  const lines = digest.split('\n');
  const out: string[] = [];
  let tokens = 0;
  for (const line of lines) {
    tokens += estimateTokens(line);
    if (tokens > approxTokens) break;
    out.push(line);
  }
  return out.join('\n');
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
