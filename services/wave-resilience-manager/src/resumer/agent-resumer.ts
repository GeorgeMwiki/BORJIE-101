/**
 * Agent resumer — dispatches a continuation agent for a revivable
 * wave.
 *
 * Per AGENT_SELF_REVIVAL_SPEC §6 — pulls the continuation prompt from
 * the builder, hands it to the injected `AgentDispatcher` (the real
 * dispatcher lives in the orchestrator service), then writes a new
 * `resuming` row + a `wave_revival_attempts` row.
 *
 * The dispatcher is an interface — production wires the Anthropic
 * Messages API client; tests inject a recording stub.
 */

import type { ProgressRepository } from '../storage/progress-repository.js';
import type { AttemptsRepository } from '../storage/attempts-repository.js';
import { sealEvent, type AuditChainState } from '../audit/audit-emit.js';
import { buildContinuationPrompt } from '../builder/continuation-prompt-builder.js';
import { decideRevival } from '../decider/revival-decider.js';
import type { ResilienceLogger, RevivalDecision } from '../types.js';
import { MAX_ATTEMPTS } from '../types.js';

export interface AgentDispatcher {
  /**
   * Dispatch a fresh agent with the given prompt. Returns the new
   * agent_id. Implementations may be async (HTTP) or sync (in-process
   * stub).
   */
  dispatch(args: {
    readonly waveId: string;
    readonly prompt: string;
    readonly attemptNumber: number;
  }): Promise<{ readonly agent_id: string }>;
}

export interface AgentResumerDeps {
  readonly progress: ProgressRepository;
  readonly attempts: AttemptsRepository;
  readonly dispatcher: AgentDispatcher;
  readonly chainState: AuditChainState;
  readonly maxAttempts?: number;
  readonly now?: () => Date;
  readonly logger?: ResilienceLogger;
}

export interface ResumeWaveInput {
  readonly waveId: string;
  readonly originalPrompt: string;
}

export interface ResumeWaveResult {
  readonly decision: RevivalDecision;
  readonly resumed: boolean;
  readonly newAgentId: string | null;
  readonly nextChainHash: string | null;
}

export async function resumeWave(
  deps: AgentResumerDeps,
  input: ResumeWaveInput,
): Promise<ResumeWaveResult> {
  const max = deps.maxAttempts ?? MAX_ATTEMPTS;
  const now = (deps.now ?? (() => new Date()))();
  let chain: AuditChainState = deps.chainState;

  // Build base decision (without continuation prompt).
  const base = await decideRevival(
    {
      progress: deps.progress,
      ...(deps.maxAttempts !== undefined ? { maxAttempts: deps.maxAttempts } : {}),
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    },
    { waveId: input.waveId, originalPrompt: input.originalPrompt },
  );

  if (!base.should_revive) {
    // Escalate to unrecoverable if we hit the cap.
    if (base.reason === 'max_attempts_reached') {
      const sealed = sealEvent(chain, {
        kind: 'wave.unrecoverable',
        wave_id: input.waveId,
        extra: { attempts: base.attempt_number },
      });
      // Mark the wave row as 'unrecoverable'. We need an agent_id for
      // the new row; reuse the latest known agent_id.
      const history = await deps.progress.listForWave(input.waveId);
      const last = history[history.length - 1];
      if (last) {
        await deps.progress.append({
          wave_id: input.waveId,
          agent_id: last.agent_id,
          tenant_id: last.tenant_id,
          status: 'unrecoverable',
          attempt_number: base.attempt_number,
          audit_hash: sealed.nextHash,
        });
      }
      chain = { previousHash: sealed.nextHash };
      deps.logger?.error(
        { wave_id: input.waveId, attempts: base.attempt_number },
        'wave-resilience: unrecoverable — operator attention required',
      );
    }
    return {
      decision: base,
      resumed: false,
      newAgentId: null,
      nextChainHash: chain.previousHash,
    };
  }

  // Build continuation prompt from the actual checkpoint row.
  const history = await deps.progress.listForWave(input.waveId);
  const checkpoint =
    history
      .slice()
      .reverse()
      .find((r) => r.checkpoint_label && r.checkpoint_label.length > 0) ??
    null;
  const continuationPrompt = buildContinuationPrompt({
    waveId: input.waveId,
    originalPrompt: input.originalPrompt,
    checkpoint,
    attemptNumber: base.attempt_number,
    maxAttempts: max,
  });

  // Mark wave as 'revivable' first.
  const sealedRevivable = sealEvent(chain, {
    kind: 'wave.revivable',
    wave_id: input.waveId,
    extra: { attempt: base.attempt_number },
  });
  const last = history[history.length - 1];
  if (last) {
    await deps.progress.append({
      wave_id: input.waveId,
      agent_id: last.agent_id,
      tenant_id: last.tenant_id,
      status: 'revivable',
      attempt_number: base.attempt_number,
      audit_hash: sealedRevivable.nextHash,
    });
  }
  chain = { previousHash: sealedRevivable.nextHash };

  // Dispatch the continuation agent.
  const dispatched = await deps.dispatcher.dispatch({
    waveId: input.waveId,
    prompt: continuationPrompt,
    attemptNumber: base.attempt_number,
  });

  // Record the attempt row.
  const originalDispatchAt = history[0]?.created_at ?? now.toISOString();
  const sealedAttempt = sealEvent(chain, {
    kind: 'attempt.recorded',
    wave_id: input.waveId,
    extra: { attempt: base.attempt_number },
  });
  await deps.attempts.record({
    wave_id: input.waveId,
    attempt_number: base.attempt_number,
    original_dispatch_at: originalDispatchAt,
    crashed_at: now.toISOString(),
    audit_hash: sealedAttempt.nextHash,
  });
  chain = { previousHash: sealedAttempt.nextHash };

  // Mark the wave as 'resuming' with the new agent_id.
  const sealedResuming = sealEvent(chain, {
    kind: 'wave.resuming',
    wave_id: input.waveId,
    extra: { new_agent_id: dispatched.agent_id, attempt: base.attempt_number },
  });
  await deps.progress.append({
    wave_id: input.waveId,
    agent_id: dispatched.agent_id,
    tenant_id: last?.tenant_id ?? null,
    status: 'resuming',
    attempt_number: base.attempt_number,
    audit_hash: sealedResuming.nextHash,
  });
  chain = { previousHash: sealedResuming.nextHash };

  await deps.attempts.markOutcome({
    wave_id: input.waveId,
    attempt_number: base.attempt_number,
    resumed_at: now.toISOString(),
    outcome: null,
  });

  deps.logger?.info(
    {
      wave_id: input.waveId,
      attempt: base.attempt_number,
      new_agent_id: dispatched.agent_id,
    },
    'wave-resilience: continuation agent dispatched',
  );

  return {
    decision: {
      ...base,
      continuation_prompt: continuationPrompt,
    },
    resumed: true,
    newAgentId: dispatched.agent_id,
    nextChainHash: chain.previousHash,
  };
}
