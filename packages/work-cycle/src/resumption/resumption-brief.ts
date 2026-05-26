/**
 * Resumption brief — deterministic, token-budgeted (spec §6).
 *
 * MemGPT-style external-memory → main-context paging
 * (Packer et al., arXiv:2310.08560). The journal is external memory;
 * the brief is the main-context working snapshot loaded at session
 * start.
 *
 * Algorithm:
 *   1. Read state.pending_threads.
 *   2. Read up to K most-recent journal entries (newest first).
 *   3. Walk entries, accumulating tokens until tokenBudget reached.
 *   4. Bucket by `outputs.kind` + `outputs.status`. Collapse repeated
 *      sweeps into one line.
 *   5. Surface `requires_owner_attention` entries into awaiting_approval.
 *   6. Surface 't2-critical' or `escalation` entries into escalations.
 *   7. Build headline = "Mr. Mwikila ran X ticks while you were away".
 *
 * Token estimate: ~4 chars/token (the standard rule of thumb for GPT-
 * style tokenisers). The brief truncates at the entry whose inclusion
 * would push past budget — partial brief is always valid.
 *
 * The brief is deterministic given the same (journal, state, budget) —
 * no LLM call on the critical resumption path. Optional LLM polish is
 * a downstream concern.
 */

import type { JournalRepository } from '../journal/journal-repository.js';
import type { StateRepository } from '../state/state-repository.js';
import type { JournalEntry, ResumptionBrief } from '../types.js';

export interface BuildBriefArgs {
  readonly tenantId: string;
  /** Default 1200 tokens. */
  readonly tokenBudget?: number;
  /** Default 20. */
  readonly maxEntries?: number;
}

export interface BuildResumptionBrief {
  (args: BuildBriefArgs): Promise<ResumptionBrief>;
}

const CHARS_PER_TOKEN = 4;
const DEFAULT_TOKEN_BUDGET = 1200;
const DEFAULT_MAX_ENTRIES = 20;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function createBuildResumptionBrief(args: {
  readonly journalRepo: JournalRepository;
  readonly stateRepo: StateRepository;
}): BuildResumptionBrief {
  return async function build({
    tenantId,
    tokenBudget = DEFAULT_TOKEN_BUDGET,
    maxEntries = DEFAULT_MAX_ENTRIES,
  }) {
    const state = await args.stateRepo.read(tenantId);
    const entries = await args.journalRepo.readLastK(tenantId, maxEntries);

    const completedOvernight: string[] = [];
    const awaitingApproval: string[] = [];
    const escalations: string[] = [];

    // Track collapsing buckets so repeated sweeps reduce to one line.
    const sweepCount = countBy(entries, (e) =>
      e.outputs.kind === 'sweep' && e.outputs.status === 'completed' ? 'sweep' : null,
    );
    const watchCount = countBy(entries, (e) =>
      e.outputs.kind === 'watch' && e.outputs.status === 'completed' ? 'watch' : null,
    );

    let runningTokens = 0;
    let truncatedEarly = false;

    // sweepCount/watchCount go first as the "fat" buckets we always
    // mention regardless of token budget.
    if (sweepCount > 0) {
      const line = `Ran ${sweepCount} anticipatory sweep${sweepCount === 1 ? '' : 's'} overnight.`;
      runningTokens += estimateTokens(line);
      completedOvernight.push(line);
    }
    if (watchCount > 0) {
      const line = `Watched price/regulator feeds across ${watchCount} ticks.`;
      runningTokens += estimateTokens(line);
      completedOvernight.push(line);
    }

    for (const entry of entries) {
      const summary = entry.outputs.summary;
      const tokens = estimateTokens(summary);
      if (runningTokens + tokens > tokenBudget) {
        truncatedEarly = true;
        break;
      }
      runningTokens += tokens;
      if (entry.outputs.requires_owner_attention) {
        awaitingApproval.push(summary);
      }
      if (entry.outputs.status === 'failed') {
        // Tier-2-critical or policy-blocked surfaces. The reason field
        // points at the blocker.
        if (entry.outputs.reason === 'killswitch') {
          escalations.push(summary);
        }
        continue;
      }
      // Non-sweep, non-watch completed entries surface individually
      // (drafts, investigations, reviews).
      const k = entry.outputs.kind;
      if (
        entry.outputs.status === 'completed' &&
        k !== 'sweep' &&
        k !== 'watch' &&
        k !== 'mode_transition'
      ) {
        completedOvernight.push(summary);
      }
    }

    const lastTickAt = state?.last_tick_at ?? null;
    const totalTicks = entries.length;
    const headline = buildHeadline({
      totalTicks,
      lastTickAt,
      truncatedEarly,
    });
    return {
      headline,
      pending_threads: state?.pending_threads ?? [],
      completed_overnight: completedOvernight,
      awaiting_approval: awaitingApproval,
      escalations,
      last_tick_at: lastTickAt,
      token_estimate: runningTokens + estimateTokens(headline),
    };
  };
}

function countBy<T>(
  entries: ReadonlyArray<T>,
  predicate: (entry: T) => string | null,
): number {
  let n = 0;
  for (const e of entries) {
    if (predicate(e) !== null) n += 1;
  }
  return n;
}

function buildHeadline(args: {
  readonly totalTicks: number;
  readonly lastTickAt: string | null;
  readonly truncatedEarly: boolean;
}): string {
  const ticks = args.totalTicks;
  const last = args.lastTickAt ?? 'never';
  if (ticks === 0) {
    return `Mr. Mwikila is awaiting his first tick (last_tick_at=${last}).`;
  }
  const trunc = args.truncatedEarly ? ' (brief truncated to fit budget)' : '';
  return `Mr. Mwikila ran ${ticks} tick${ticks === 1 ? '' : 's'} while you were away (last_tick_at=${last})${trunc}.`;
}

/**
 * Helper for tests: assert that no junior specialisation name appears
 * in the brief. The user-facing surface is "Mr. Mwikila" only.
 */
export function assertNoJuniorLeak(
  brief: ResumptionBrief,
  juniorNames: ReadonlyArray<string>,
): void {
  const blob = [
    brief.headline,
    ...brief.completed_overnight,
    ...brief.awaiting_approval,
    ...brief.escalations,
  ].join(' ');
  for (const name of juniorNames) {
    if (blob.toLowerCase().includes(name.toLowerCase())) {
      throw new Error(
        `Junior specialisation name "${name}" leaked into ResumptionBrief`,
      );
    }
  }
}

// Re-export deterministic constants for callers + tests.
export { CHARS_PER_TOKEN, DEFAULT_TOKEN_BUDGET, DEFAULT_MAX_ENTRIES };

/**
 * Standalone signature alias used by tests + the index re-export.
 */
export type ResumptionBriefFn = BuildResumptionBrief;

/**
 * Note: we DON'T re-export `JournalEntry` here — callers import it from
 * `../types.js` directly. Keeping the module surface lean reduces churn.
 */
export type { JournalEntry };
