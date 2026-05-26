/**
 * Thread-resumer — composes the "welcome back" briefing prepended to
 * Mr. Mwikila's next system prompt (Wave 18GG).
 *
 * Pure orchestration over three already-fetched inputs:
 *   1. The latest session-memory snapshot (may be null).
 *   2. The latest thread summary (may be null).
 *   3. The unresolved pending threads for this user.
 *
 * The caller fetches these in parallel.
 */

import type {
  PendingThread,
  SessionMemory,
  ThreadSummary,
} from '../types.js';

export interface ResumptionBriefInput {
  readonly session: SessionMemory | null;
  readonly latest_summary: ThreadSummary | null;
  readonly unresolved_pending: ReadonlyArray<PendingThread>;
  readonly user_display_name: string;
}

export interface ResumptionBrief {
  readonly greeting_md: string;
  readonly context_md: string;
  readonly pending_count: number;
  readonly is_cold_start: boolean;
}

export function composeResumptionBrief(
  input: ResumptionBriefInput,
): ResumptionBrief {
  const isColdStart =
    input.session === null &&
    input.latest_summary === null &&
    input.unresolved_pending.length === 0;

  if (isColdStart) {
    return {
      greeting_md: `Welcome, ${input.user_display_name}.`,
      context_md: '',
      pending_count: 0,
      is_cold_start: true,
    };
  }

  const greetingMd = `Welcome back, ${input.user_display_name} — we are continuing from where we left off.`;

  const contextParts: string[] = [];
  if (input.session) {
    contextParts.push(`## Session summary\n${input.session.summary_md}`);
  }
  if (input.latest_summary) {
    contextParts.push(
      `## Earlier thread summary (turns ${input.latest_summary.summarised_turn_range[0]}–${input.latest_summary.summarised_turn_range[1]})\n${input.latest_summary.summary_md}`,
    );
  }
  if (input.unresolved_pending.length > 0) {
    const lines = input.unresolved_pending.map(
      (p) =>
        `- **${p.pending_kind}** (since ${p.created_at}): ${JSON.stringify(p.payload)}`,
    );
    contextParts.push(`## Pending\n${lines.join('\n')}`);
  }

  return {
    greeting_md: greetingMd,
    context_md: contextParts.join('\n\n'),
    pending_count: input.unresolved_pending.length,
    is_cold_start: false,
  };
}
