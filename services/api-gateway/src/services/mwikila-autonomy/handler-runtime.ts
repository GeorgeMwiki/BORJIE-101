/**
 * Mr. Mwikila handler runtime — the small orchestrator every per-
 * category autonomous handler invokes.
 *
 * Lifecycle:
 *   1. Handler's `propose()` is called by a cron tick.
 *   2. Runtime resolves the delegation tier via the store.
 *   3. Runtime calls the inviolable-rail check on the descriptor the
 *      handler built. On a block, recorder writes a
 *      `blocked_by_inviolable` row + emits a cockpit alert.
 *   4. Runtime asks the recorder to record the action with the
 *      resolved tier. T0/T1 land as `proposed`; T2/T3 land as
 *      `executed` (with reversal_token for T2).
 *   5. Runtime returns the inbox row to the cron.
 *
 * Handlers stay pure — they do not know about the recorder, the
 * inviolable rails, or the delegation store.
 */

import { autonomy } from '@borjie/central-intelligence';

import type { MwikilaInboxRecorder } from './inbox-recorder.js';
import type { MwikilaDelegationStore } from './delegation-store.js';
import type {
  DelegationCategory,
  DelegationTier,
  MwikilaInboxRow,
} from './types.js';

/**
 * What a handler returns from its `propose()` call — the runtime
 * stitches this with the resolved delegation + rails outcome.
 */
export interface MwikilaHandlerProposal {
  readonly actionKind: string;
  readonly category: DelegationCategory;
  readonly summary: string;
  readonly summarySw: string;
  readonly rationale: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** Money out (TZS) — feeds the envelope check. */
  readonly amountTzs?: number;
  /** Currency — feeds the non-TZS rail. */
  readonly currency?: string;
  /** Target relation (family / staff / counterparty) — feeds the
   *  family-member rail. */
  readonly targetRelation?: 'family' | 'staff' | 'counterparty' | null;
}

export interface MwikilaHandler {
  readonly actionKind: string;
  readonly category: DelegationCategory;
  /**
   * Build the proposal. Returns `null` when there is nothing to do
   * this tick (e.g. no expiring license). The runtime skips a `null`
   * proposal silently — it is not an error.
   */
  propose(args: {
    readonly tenantId: string;
    readonly actingOnUserId: string;
    readonly now: Date;
  }): Promise<MwikilaHandlerProposal | null>;
}

export interface MwikilaHandlerRuntimeDeps {
  readonly recorder: MwikilaInboxRecorder;
  readonly delegations: MwikilaDelegationStore;
  /**
   * Returns true when the platform kill-switch is open.
   * Defaults to a constant `false` for tests; the composition root
   * wires the real port.
   */
  readonly isKillSwitchOpen?: () => Promise<boolean> | boolean;
  readonly now?: () => Date;
}

export interface MwikilaHandlerRuntime {
  run(args: {
    readonly tenantId: string;
    readonly actingOnUserId: string;
    readonly handler: MwikilaHandler;
  }): Promise<MwikilaInboxRow | null>;
}

/**
 * Build a runtime instance. The runtime is stateless — one instance
 * is fine for the whole process.
 */
export function createMwikilaHandlerRuntime(
  deps: MwikilaHandlerRuntimeDeps,
): MwikilaHandlerRuntime {
  const now = deps.now ?? (() => new Date());
  return Object.freeze({
    async run({ tenantId, actingOnUserId, handler }) {
      const proposal = await handler.propose({
        tenantId,
        actingOnUserId,
        now: now(),
      });
      if (proposal === null) return null;

      const resolved = await deps.delegations.resolve({
        tenantId,
        category: proposal.category,
      });

      const killSwitchOpen = deps.isKillSwitchOpen
        ? Boolean(await deps.isKillSwitchOpen())
        : false;

      const verdict = autonomy.checkAutonomyInviolable({
        category: proposal.category,
        amountTzs: proposal.amountTzs ?? 0,
        currency: proposal.currency ?? 'TZS',
        targetRelation: proposal.targetRelation ?? null,
        envelopeThresholdTzs: resolved.envelopeThresholdTzs,
        killSwitchOpen,
      });

      if (verdict.status === 'block') {
        return deps.recorder.recordBlocked({
          tenantId,
          actingOnUserId,
          actionKind: proposal.actionKind,
          category: proposal.category,
          delegationTier: resolved.tier as DelegationTier,
          summary: proposal.summary,
          summarySw: proposal.summarySw,
          rationale: proposal.rationale,
          payload: proposal.payload,
          blockedReason: verdict.reason ?? 'unknown',
          provenance: { via: 'mwikila', verdict: verdict.reason ?? null },
        });
      }

      return deps.recorder.recordAction({
        tenantId,
        actingOnUserId,
        actionKind: proposal.actionKind,
        category: proposal.category,
        delegationTier: resolved.tier,
        summary: proposal.summary,
        summarySw: proposal.summarySw,
        rationale: proposal.rationale,
        payload: proposal.payload,
        reversalWindowHours: resolved.reversalWindowHours,
        provenance: { via: 'mwikila', resolvedFrom: resolved.source },
      });
    },
  });
}
