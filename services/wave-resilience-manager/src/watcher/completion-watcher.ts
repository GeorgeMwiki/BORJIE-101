/**
 * Completion watcher — detects when a wave has successfully completed
 * (commits landed + pushed) and transitions the wave row to
 * `completed`.
 *
 * Per AGENT_SELF_REVIVAL_SPEC §6. The watcher is fed by either:
 *   - an explicit `wave.checkpoint('pushed', {})` call from the agent
 *     (preferred), or
 *   - a polling git-log inspector for legacy agents (the inferred
 *     checkpoint migration path described in spec §7).
 */

import type { ProgressRepository } from '../storage/progress-repository.js';
import type { AttemptsRepository } from '../storage/attempts-repository.js';
import { sealEvent, type AuditChainState } from '../audit/audit-emit.js';
import type { ResilienceLogger, WaveProgressEntry } from '../types.js';

export interface CompletionWatcherDeps {
  readonly progress: ProgressRepository;
  readonly attempts: AttemptsRepository;
  readonly chainState: AuditChainState;
  readonly now?: () => Date;
  readonly logger?: ResilienceLogger;
}

export interface SignalCompletionInput {
  readonly waveId: string;
}

export interface CompletionResult {
  readonly completed: boolean;
  readonly reason: string;
  readonly nextChainHash: string | null;
}

/**
 * Decide whether a wave can move to `completed` — the latest row must
 * have label `'pushed'`. Pure function.
 */
export function canComplete(
  history: ReadonlyArray<WaveProgressEntry>,
): { ok: true; row: WaveProgressEntry } | { ok: false; reason: string } {
  const last = history[history.length - 1];
  if (!last) return { ok: false, reason: 'no_history' };
  if (last.status === 'completed') {
    return { ok: false, reason: 'already_completed' };
  }
  if (last.checkpoint_label !== 'pushed') {
    return { ok: false, reason: 'last_label_not_pushed' };
  }
  return { ok: true, row: last };
}

export async function signalCompletion(
  deps: CompletionWatcherDeps,
  input: SignalCompletionInput,
): Promise<CompletionResult> {
  const history = await deps.progress.listForWave(input.waveId);
  const check = canComplete(history);
  if (!check.ok) {
    return {
      completed: false,
      reason: check.reason,
      nextChainHash: deps.chainState.previousHash,
    };
  }

  const now = (deps.now ?? (() => new Date()))();
  const sealed = sealEvent(deps.chainState, {
    kind: 'wave.completed',
    wave_id: input.waveId,
    seq: check.row.checkpoint_seq + 1,
  });
  await deps.progress.append({
    wave_id: input.waveId,
    agent_id: check.row.agent_id,
    tenant_id: check.row.tenant_id,
    status: 'completed',
    checkpoint_label: 'pushed',
    checkpoint_payload: check.row.checkpoint_payload,
    attempt_number: check.row.attempt_number,
    audit_hash: sealed.nextHash,
  });

  // Update the latest attempt row to outcome='completed'.
  await deps.attempts.markOutcome({
    wave_id: input.waveId,
    attempt_number: check.row.attempt_number,
    completed_at: now.toISOString(),
    outcome: 'completed',
  });

  deps.logger?.info(
    { wave_id: input.waveId, attempt: check.row.attempt_number },
    'wave-resilience: wave completed',
  );

  return {
    completed: true,
    reason: 'pushed',
    nextChainHash: sealed.nextHash,
  };
}
