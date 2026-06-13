/**
 * The self-healing report sink — INTERNAL-ADMIN / platform-scoped, never the
 * owner. Every blocker the MAPE-K loop processes (auto-healed observation OR
 * human-gated escalation) is a Borjie engineering signal; the owner runs their
 * estate and must never see or approve the platform healing its own wiring.
 *
 * Two effects, both fail-safe:
 *   1. A structured `audience: 'internal-admin'` log line (admin observability).
 *   2. Fire-and-forget PERSISTENCE to the `self_healing_proposals` queue (the
 *      admin console) — via a store the composition root REGISTERS at boot.
 *      Until registered (or with no DB), the sink is log-only; it never throws
 *      and never blocks the heal loop it serves.
 *
 * Shared by the composition root (read-path seam), the router (resolver
 * unmapped-binding seam), and the genui-telemetry beacon (projector
 * unknown-kind seam) — a standalone module so none of them import each other.
 *
 * @module composition/portal-genui/internal-admin-sink
 */

import type { RepairOutcome, BlockerSignal } from '@borjie/portal-genui';
import { logger } from '../../utils/logger.js';

/** The narrow persist port the composition root registers at boot. */
export type SelfHealingRecordPort = (
  outcome: RepairOutcome,
  signal: BlockerSignal,
) => Promise<void>;

// Composition-root registration seam (like a logger): a single live persist
// port wired once at boot. Module-level by design — the router imports the
// `escalateToInternalAdmin` singleton directly, so a registration hook is the
// lowest-friction way to give it durable persistence without threading the DB
// through every per-request resolver construction.
let registeredStore: SelfHealingRecordPort | null = null;

/**
 * Register the live (service-role) persist port. Called once by the composition
 * root when a DB is wired. Idempotent-by-overwrite.
 */
export function registerSelfHealingStore(port: SelfHealingRecordPort): void {
  registeredStore = port;
}

/** Test/teardown hook — drop the registered store. */
export function resetSelfHealingStore(): void {
  registeredStore = null;
}

/**
 * The unified `report` sink. Wire this to `attemptHeal`'s `report` (and, for
 * back-compat, `escalate`) so the admin console sees BOTH auto-healed
 * observations and needs-approval proposals.
 */
export const escalateToInternalAdmin = (
  outcome: RepairOutcome,
  signal: BlockerSignal,
): void => {
  const proposal = outcome?.proposal;
  const escalated = outcome?.status === 'escalated';

  logger.warn(
    {
      audience: 'internal-admin',
      selfHealing: true,
      status: outcome?.status,
      repairClass: outcome?.class,
      blockerKind: signal?.kind,
      locus: signal?.locus,
      autoApplicable: proposal?.autoApplicable,
      suggestedFix: proposal?.suggestedFix,
      // triage context only — never routed to the owner
      tenantId: signal?.tenantId,
    },
    `self-healing ${escalated ? 'escalation → internal admin' : 'observation'}: ${proposal?.title ?? `blocker: ${signal?.kind ?? 'unknown'}`}`,
  );

  // Fire-and-forget persistence; a slow/failing store must never block or
  // break the customer-serving heal loop.
  const store = registeredStore;
  if (store) {
    void Promise.resolve()
      .then(() => store(outcome, signal))
      .catch((err) => {
        logger.error(
          { err, locus: signal?.locus, blockerKind: signal?.kind },
          'self-healing store persist failed (non-fatal; logged above)',
        );
      });
  }
};
