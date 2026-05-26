/**
 * Revival decider — given a crashed wave, decide whether to revive
 * (attempt < 3 + checkpoint exists) or escalate to unrecoverable
 * (attempt >= 3).
 *
 * Per AGENT_SELF_REVIVAL_SPEC §3 R4 + §6.
 */

import type { ProgressRepository } from '../storage/progress-repository.js';
import type {
  RevivalDecision,
  WaveProgressEntry,
  ResilienceLogger,
} from '../types.js';
import { MAX_ATTEMPTS } from '../types.js';

export interface RevivalDeciderDeps {
  readonly progress: ProgressRepository;
  readonly maxAttempts?: number;
  readonly logger?: ResilienceLogger;
}

export interface DecideInput {
  readonly waveId: string;
  /** Original dispatch prompt (verbatim). Required for resume. */
  readonly originalPrompt: string;
}

/**
 * Pick the last completed checkpoint for a wave — the most recent
 * entry whose status is `'running' | 'checkpoint' | 'crashed'` and
 * whose `checkpoint_label` is not null.
 *
 * The `crashed` row inherits the previous label, so we can resume from
 * the last real piece of progress.
 */
export function selectLastCheckpoint(
  history: ReadonlyArray<WaveProgressEntry>,
): WaveProgressEntry | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (!row) continue;
    if (row.checkpoint_label && row.checkpoint_label.length > 0) {
      return row;
    }
  }
  return null;
}

export async function decideRevival(
  deps: RevivalDeciderDeps,
  input: DecideInput,
): Promise<RevivalDecision> {
  const max = deps.maxAttempts ?? MAX_ATTEMPTS;
  const history = await deps.progress.listForWave(input.waveId);

  if (history.length === 0) {
    return {
      wave_id: input.waveId,
      should_revive: false,
      last_completed_checkpoint: null,
      continuation_prompt: '',
      attempt_number: 0,
      reason: 'no_history',
    };
  }

  const lastRow = history[history.length - 1];
  // exactOptionalPropertyTypes: lastRow may technically be undefined to
  // the type system after the index access; guard.
  const lastAttempt = lastRow?.attempt_number ?? 1;
  const nextAttempt = lastAttempt + 1;

  if (nextAttempt > max) {
    deps.logger?.warn(
      { wave_id: input.waveId, attempts: lastAttempt },
      'wave-resilience: attempt cap exceeded',
    );
    return {
      wave_id: input.waveId,
      should_revive: false,
      last_completed_checkpoint: null,
      continuation_prompt: '',
      attempt_number: lastAttempt,
      reason: 'max_attempts_reached',
    };
  }

  const checkpoint = selectLastCheckpoint(history);
  if (!checkpoint) {
    deps.logger?.warn(
      { wave_id: input.waveId },
      'wave-resilience: no checkpoint to resume from',
    );
    return {
      wave_id: input.waveId,
      should_revive: false,
      last_completed_checkpoint: null,
      continuation_prompt: '',
      attempt_number: lastAttempt,
      reason: 'no_checkpoint',
    };
  }

  return {
    wave_id: input.waveId,
    should_revive: true,
    last_completed_checkpoint: checkpoint.checkpoint_label,
    continuation_prompt: '', // assembled by continuation-prompt-builder
    attempt_number: nextAttempt,
    reason: 'checkpoint_resumable',
  };
}
