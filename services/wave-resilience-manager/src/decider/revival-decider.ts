/**
 * Revival decider — given a crashed wave, decide whether to revive
 * (attempt < 3 + checkpoint exists) or escalate to unrecoverable
 * (attempt >= 3).
 *
 * Per AGENT_SELF_REVIVAL_SPEC §3 R4 + §6.
 */

import type { ProgressRepository } from '../storage/progress-repository.js';
import type { DailyCounterRepository } from '../storage/daily-counter-repository.js';
import type {
  RevivalDecision,
  WaveProgressEntry,
  ResilienceLogger,
} from '../types.js';
import { MAX_ATTEMPTS } from '../types.js';

export interface RevivalDeciderDeps {
  readonly progress: ProgressRepository;
  readonly maxAttempts?: number;
  /**
   * Optional platform-wide daily attempt budget (founder decision #5).
   * When provided alongside `dailyCounters`, a wave is refused with
   * reason `daily_budget_exhausted` once today's count >= budget.
   * When either is absent, the daily cap is not enforced — preserves
   * pre-existing behaviour and keeps unit tests focused.
   */
  readonly dailyBudget?: number;
  readonly dailyCounters?: DailyCounterRepository;
  readonly logger?: ResilienceLogger;
}

export interface DecideInput {
  readonly waveId: string;
  /** Original dispatch prompt (verbatim). Required for resume. */
  readonly originalPrompt: string;
  /** Optional tenant id for per-tenant counter scoping (default platform-wide). */
  readonly tenantId?: string | null;
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

  // Daily budget gate (founder decision #5).
  //
  // Only enforced when BOTH a budget value and a counter repo are
  // supplied. The check is intentionally read-only here — the resumer
  // increments the counter when it actually dispatches a continuation
  // agent, so the decider can be re-run cheaply without inflating the
  // counter.
  if (
    deps.dailyBudget !== undefined &&
    deps.dailyCounters !== undefined &&
    deps.dailyBudget > 0
  ) {
    const tenantScope = input.tenantId ?? undefined;
    const todayCount = await deps.dailyCounters.getTodayAttemptCount(
      tenantScope,
    );
    if (todayCount >= deps.dailyBudget) {
      deps.logger?.warn(
        {
          wave_id: input.waveId,
          today_count: todayCount,
          budget: deps.dailyBudget,
        },
        'wave-resilience: daily revival budget exhausted',
      );
      return {
        wave_id: input.waveId,
        should_revive: false,
        last_completed_checkpoint: checkpoint.checkpoint_label,
        continuation_prompt: '',
        attempt_number: lastAttempt,
        reason: 'daily_budget_exhausted',
      };
    }
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
