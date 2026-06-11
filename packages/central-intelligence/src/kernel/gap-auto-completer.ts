/**
 * GapAutoCompleter — the verifier-gated auto-completion of a deferred capability
 * gap when its blocker clears (Loop A, P0;
 * `Docs/research/THE_METACOGNITIVE_SELF_MODEL.md` §3.5).
 *
 * THE WHOLE SAFETY POINT lives here. When a `GapCleared` fires the gap must
 * NOT blindly complete. The sequence — and each non-negotiable invariant — is:
 *
 *   1. SOVEREIGN PARK. A sovereign gap (money / licence-suspension / deletion /
 *      four-eye class) NEVER auto-actuates. The cleared blocker only moves it to
 *      `needs_approval` (parked HITL) — it waits for a human four-eye signal
 *      forever. Higher autonomy on these paths raises risk super-linearly.
 *   2. blocked → scheduled. The gap is advanced (audit-chain stitched) so the
 *      deferred continuation is re-queued.
 *   3. STALE-RESUME RE-VALIDATION. The continuation re-validates the gap's
 *      preconditions AT RESUME TIME (the world may have changed between filing
 *      and clearing — the property→mining pivot is the live example). A failed
 *      re-validation REOPENS the gap; it does not complete stale work.
 *   4. EXTERNAL VERIFY. The re-attempt's result is checked by the EXTERNAL
 *      verifier (the Auditor evidence-chain gate: >=1 evidence_id, no
 *      contradiction). Completion is gated on the verifier's `approve`, NEVER on
 *      the agent self-grading its own output (intrinsic self-correction degrades
 *      reasoning — Huang et al. ICLR 2024; CRITIC, Gou et al. ICLR 2024).
 *   5. done / reopen. On verify `approve` → status `done` + `confirmedAt`
 *      stamped + the audit-chain row appended. On reject / failed re-validation →
 *      status is left NOT `done` (no false-green; the stale-cache FALSE-green
 *      guard) and a reason is recorded.
 *
 * PURE ORCHESTRATION over injected ports — no IO of its own, so it is fully
 * unit-testable against fakes.
 */

import type { GapCleared } from './gap-registry-watcher.js';

/** The outcome of one auto-completion attempt. Pure data. */
export type GapCompletionOutcome =
  | 'completed' // verifier passed → status done + confirmedAt
  | 'reopened' // re-validation or verifier failed → NOT done (no false-green)
  | 'parked_sovereign' // sovereign gap → needs_approval, awaits four-eye signal
  | 'skipped'; // gap not found / not advanceable this pass

export interface GapCompletionResult {
  readonly gapId: string;
  readonly outcome: GapCompletionOutcome;
  /** Human-readable reason (audit-chain body). Always present. */
  readonly reason: string;
}

/**
 * The re-validation + re-attempt of the deferred continuation. For P0 this may
 * be minimal (re-check the precondition still holds + re-queue the work), but it
 * MUST return a verifiable artifact (an evidence chain) the external verifier
 * can judge — never a self-asserted "done".
 */
export interface DeferredContinuation {
  /**
   * Re-validate the gap's preconditions at resume time and re-attempt the
   * deferred work. Returns the evidence ids the re-attempt produced (the
   * artifact the verifier judges) or a failure when preconditions no longer
   * hold (→ reopen, never complete stale work).
   */
  reattempt(cleared: GapCleared): Promise<ReattemptResult>;
}

export type ReattemptResult =
  | {
      readonly ok: true;
      /** Evidence ids the re-attempt produced — handed to the verifier. */
      readonly evidenceIds: ReadonlyArray<string>;
    }
  | {
      readonly ok: false;
      /** Why preconditions no longer hold (stale-resume) — reopens the gap. */
      readonly reason: string;
    };

/**
 * The EXTERNAL verifier — the Auditor evidence-chain gate. It receives the
 * re-attempt's evidence and returns whether completion is allowed. This is the
 * ONLY thing that can authorise `done`; the agent never grades itself.
 */
export interface ExternalVerifier {
  verify(args: {
    readonly gapId: string;
    readonly evidenceIds: ReadonlyArray<string>;
  }): Promise<VerifierVerdict>;
}

export interface VerifierVerdict {
  /** True only when >=1 evidence_id resolves AND nothing contradicts. */
  readonly approved: boolean;
  /** The confirmation kind stamped on `done` (e.g. 'auditor_approved'). */
  readonly confirmationKind: string;
  /** When rejected — the missing/contradicting evidence (audit body). */
  readonly reason: string;
}

/**
 * The gap-status sink — the durable advance with the audit-chain stitch. The
 * composition root implements it over the `MdCommitmentRepository`
 * (`advanceGapStatus`). Each call appends append-only to the hash chain.
 */
export interface GapStatusSink {
  /** blocked → scheduled (re-queue the continuation). */
  schedule(gapId: string, reason: string): Promise<void>;
  /**
   * scheduled → done + confirmedAt (verifier passed). The underlying
   * `advanceGapStatus` REQUIRES the external `confirmationKind` and rejects a
   * `done` from any state but `scheduled` — there is no self-grade path here.
   */
  complete(
    gapId: string,
    confirmationKind: string,
    reason: string,
  ): Promise<void>;
  /**
   * → reopened (verifier rejected / stale-resume failed). NOT done. The
   * underlying advance increments the reopened-attempt cap; once the cap is hit
   * the row is moved to the TERMINAL `dead_letter` status (out of the live set)
   * so a failing gap cannot re-fire + re-verify forever (the reattempt storm).
   */
  reopen(gapId: string, reason: string): Promise<void>;
  /**
   * → needs_approval (sovereign park, awaits four-eye). NEVER auto-actuates.
   * This MUST write the TERMINAL `needs_approval` status so the parked gap
   * EXITS the watcher live set — otherwise the watcher would re-surface it and
   * re-park it every tick (the park storm). Only a human approval transitions
   * it out. The production statusSink advances to `needs_approval`; clearing
   * the blocker alone never releases a sovereign action.
   */
  parkForApproval(gapId: string, reason: string): Promise<void>;
}

export interface GapAutoCompleterDeps {
  readonly statusSink: GapStatusSink;
  readonly continuation: DeferredContinuation;
  readonly verifier: ExternalVerifier;
  readonly logger?: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

const NOOP_LOGGER = { info(): void {}, warn(): void {} };

export interface GapAutoCompleter {
  /** Drive one cleared gap through the verifier-gated completion sequence. */
  complete(cleared: GapCleared): Promise<GapCompletionResult>;
}

export function createGapAutoCompleter(
  deps: GapAutoCompleterDeps,
): GapAutoCompleter {
  const logger = deps.logger ?? NOOP_LOGGER;

  async function complete(cleared: GapCleared): Promise<GapCompletionResult> {
    // (1) SOVEREIGN PARK — sovereign gaps NEVER auto-actuate. The cleared
    // blocker only moves them to needs_approval; a human four-eye signal is the
    // only thing that releases them. This is checked FIRST so no sovereign gap
    // can ever reach the re-attempt path.
    if (cleared.sovereign || cleared.gapKind === 'needs_approval') {
      const reason =
        'sovereign gap — blocker cleared but parked for four-eye human approval (never auto-actuates)';
      await deps.statusSink.parkForApproval(cleared.gapId, reason);
      logger.info('gap-auto-completer: parked sovereign', {
        gapId: cleared.gapId,
      });
      return Object.freeze({
        gapId: cleared.gapId,
        outcome: 'parked_sovereign',
        reason,
      });
    }

    // (2) blocked → scheduled — re-queue the continuation.
    await deps.statusSink.schedule(
      cleared.gapId,
      `blocker cleared (${cleared.trigger.kind}:${cleared.trigger.target}) — re-queued`,
    );

    // (3) STALE-RESUME RE-VALIDATION + re-attempt of the deferred work.
    const attempt = await deps.continuation.reattempt(cleared);
    if (!attempt.ok) {
      // Preconditions no longer hold — reopen, never complete stale work.
      const reason = `stale-resume: ${attempt.reason}`;
      await deps.statusSink.reopen(cleared.gapId, reason);
      logger.warn('gap-auto-completer: reopened (stale-resume)', {
        gapId: cleared.gapId,
        reason: attempt.reason,
      });
      return Object.freeze({
        gapId: cleared.gapId,
        outcome: 'reopened',
        reason,
      });
    }

    // (4) EXTERNAL VERIFY — the Auditor evidence-chain gate. The ONLY authoriser
    // of `done`. The agent never grades its own output.
    const verdict = await deps.verifier.verify({
      gapId: cleared.gapId,
      evidenceIds: attempt.evidenceIds,
    });

    // (5a) Verifier rejected → reopen, NOT done (no false-green).
    if (!verdict.approved) {
      const reason = `verifier rejected: ${verdict.reason}`;
      await deps.statusSink.reopen(cleared.gapId, reason);
      logger.warn('gap-auto-completer: reopened (verifier rejected)', {
        gapId: cleared.gapId,
        reason: verdict.reason,
      });
      return Object.freeze({
        gapId: cleared.gapId,
        outcome: 'reopened',
        reason,
      });
    }

    // (5b) Verifier approved → done + confirmedAt + audit-chain append.
    const reason = `verifier approved (${verdict.confirmationKind})`;
    await deps.statusSink.complete(
      cleared.gapId,
      verdict.confirmationKind,
      reason,
    );
    logger.info('gap-auto-completer: completed', { gapId: cleared.gapId });
    return Object.freeze({
      gapId: cleared.gapId,
      outcome: 'completed',
      reason,
    });
  }

  return { complete };
}
