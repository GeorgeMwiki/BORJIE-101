/**
 * Outcome-observer — cron-driven worker that attaches ground truth to
 * pending intel_invocation_audit rows.
 *
 * Spec §2 + §4 of Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 *
 * The wrapper writes a pending row at call time. Once the intel-kind's
 * measurement horizon elapses (forecast: realised at the forecast
 * horizon; anomaly: labelled-incident lookup; recommendation: click
 * feedback window; etc.) the observer:
 *
 *   1. Pulls the K oldest pending rows for this `(tenant, intel_kind)`.
 *   2. Asks the supplied `OutcomeFeedPort` for ground truth.
 *   3. Writes the observation back through the audit repository.
 *   4. Forwards the resolved row through the catalogue `OutcomeRepository`
 *      so the existing capability-measurement worker observes the
 *      `Outcome` exactly as it observes research/compose outcomes.
 *
 * The observer is intentionally a pure orchestrator — it owns no
 * domain logic. All ground-truth fetching is delegated to the
 * `OutcomeFeedPort` so an LLM-judge, a label table, or a click stream
 * can each implement the same contract.
 *
 * @module @borjie/intel-self-improve/observe/outcome-observer
 */

import { randomUUID } from 'node:crypto';
import { hashChainEntry } from '@borjie/audit-hash-chain';
import type {
  ObservedOutcome,
  Outcome,
  OutcomeRepository,
  UserFollowthrough,
} from '@borjie/capability-catalogue';
import type { Logger } from '@borjie/observability';
import type {
  IntelInvocationAuditRepository,
  IntelInvocationAuditRow,
} from '../repositories/intel-invocation-audit-repository.js';
import type { IntelKind, OutcomeObservation } from '../types.js';

// ---------------------------------------------------------------------------
// Ground-truth feed port — caller-supplied implementation
// ---------------------------------------------------------------------------

export interface OutcomeFeedSnapshot {
  readonly observedOutcome: ObservedOutcome;
  readonly userFollowthrough: UserFollowthrough;
  readonly observationPayload: Readonly<Record<string, unknown>>;
  /** Default 0.5; the catalogue stores this on its Outcome row. */
  readonly claimedConfidence?: number;
  /** When the feed produced this row; defaults to `clock.now()`. */
  readonly observedAtIso?: string;
}

export interface OutcomeFeedPort {
  /**
   * Resolve the ground truth for one pending invocation. Return `null`
   * when the horizon has not yet been reached (the observer leaves
   * the row in the pending queue).
   */
  resolve(
    row: IntelInvocationAuditRow,
  ): Promise<OutcomeFeedSnapshot | null>;
}

// ---------------------------------------------------------------------------
// Cron tick configuration — one row per intel-kind per cron run
// ---------------------------------------------------------------------------

export interface OutcomeObserverConfig {
  readonly tenantId: string;
  readonly intelKind: IntelKind;
  readonly horizonMs: number;
  readonly batchSize: number;
}

export interface OutcomeObserverDeps {
  readonly auditRepo: IntelInvocationAuditRepository;
  readonly outcomeRepo: OutcomeRepository;
  readonly feed: OutcomeFeedPort;
  readonly logger: Logger;
  readonly clock?: { now(): Date };
  readonly idGen?: { next(): string };
}

export interface OutcomeObserverTickResult {
  readonly attached: number;
  readonly skipped: number;
}

const DEFAULT_CLOCK = Object.freeze({ now: () => new Date() });
const DEFAULT_ID_GEN = Object.freeze({ next: () => randomUUID() });

/**
 * Run one cron tick. Returns counts of attached + skipped rows so the
 * caller can emit metrics. Non-throwing: per-row failures are logged
 * and counted as skipped; the worker continues with the next row.
 */
export async function runOutcomeObserverTick(
  config: OutcomeObserverConfig,
  deps: OutcomeObserverDeps,
): Promise<OutcomeObserverTickResult> {
  const clock = deps.clock ?? DEFAULT_CLOCK;
  const idGen = deps.idGen ?? DEFAULT_ID_GEN;
  const now = clock.now();
  const olderThan = new Date(now.getTime() - config.horizonMs).toISOString();

  const due = await deps.auditRepo.listPendingObservations({
    tenantId: config.tenantId,
    intelKind: config.intelKind,
    olderThan,
    limit: config.batchSize,
  });

  let attached = 0;
  let skipped = 0;

  for (const row of due) {
    try {
      const resolved = await deps.feed.resolve(row);
      if (resolved === null) {
        skipped += 1;
        continue;
      }
      const observedAtIso = resolved.observedAtIso ?? now.toISOString();
      const observation: OutcomeObservation = Object.freeze({
        invocationId: row.id,
        observedOutcome: resolved.observedOutcome,
        userFollowthrough: resolved.userFollowthrough,
        observationPayload: resolved.observationPayload,
        observedAt: observedAtIso,
      });
      await deps.auditRepo.attachObservation(observation);

      const claimed =
        typeof resolved.claimedConfidence === 'number'
          ? clamp01(resolved.claimedConfidence)
          : clamp01(row.claimedConfidence);
      const outcomeId = idGen.next();
      const outcome: Outcome = Object.freeze({
        id: outcomeId,
        invocationId: row.id,
        claimedConfidence: claimed,
        observedOutcome: resolved.observedOutcome,
        userFollowthrough: resolved.userFollowthrough,
        recordedAt: observedAtIso,
        auditHash: hashChainEntry({
          prev: row.auditHash,
          payload: {
            invocationId: row.id,
            observedOutcome: resolved.observedOutcome,
            userFollowthrough: resolved.userFollowthrough,
            recordedAt: observedAtIso,
          },
        }),
      });
      await deps.outcomeRepo.insert(outcome);
      attached += 1;
    } catch (error: unknown) {
      deps.logger.error('outcome-observer row failed', {
        tenantId: config.tenantId,
        intelKind: config.intelKind,
        invocationId: row.id,
        error,
      });
      skipped += 1;
    }
  }

  return Object.freeze({ attached, skipped });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
