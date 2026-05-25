/**
 * Autonomy guard wiring — Wave 28.
 *
 * Thin factory that constructs the `AutonomyGuardFn` domain services
 * import (optionally) so every autonomous mutation flows through a
 * single policy → grant → audit → execute chokepoint.
 *
 * The factory pulls the three wave-27 primitives out of the
 * `ServiceRegistry`:
 *
 *   - `AutonomyPolicyService` — already wired at registry[autonomy].policyService
 *   - `ApprovalGrantService`  — in-memory fallback when the registry
 *                                does not expose a live instance yet
 *   - `AuditTrailRecorder`    — in-memory fallback for the same reason
 *
 * The in-memory fallbacks keep Wave 28 runnable even before the
 * audit-trail + approval-grants repositories are plugged into the
 * registry barrel. Production composition can (and should) swap them
 * for the Postgres-backed adapters as a follow-up without changing the
 * domain-service call sites.
 *
 * Default `onApprovalRequired` queues to the Autonomy Exception Inbox
 * (in-memory in both modes until the Postgres repo lands).
 */

import {
  ExceptionInbox,
  InMemoryExceptionRepository,
  withAutonomyGuard,
  type AutonomyGuardFn,
  type OnApprovalRequiredFn,
} from '@borjie/ai-copilot/autonomy';
import {
  ApprovalGrantService,
  InMemoryApprovalGrantRepository,
} from '@borjie/ai-copilot/approval-grants';
import {
  createAuditTrailRecorder,
  createInMemoryAuditTrailRepo,
  type AuditTrailRecorder,
} from '@borjie/ai-copilot/audit-trail';
import type { ServiceRegistry } from './service-registry.js';
import { logger } from '../utils/logger.js';

export interface AutonomyGuardDeps {
  readonly guard: AutonomyGuardFn;
  readonly grantService: ApprovalGrantService;
  readonly auditRecorder: AuditTrailRecorder;
  readonly exceptionInbox: ExceptionInbox;
}

/**
 * Build the autonomy-guard bundle used by domain-service composition
 * (routers pass the returned `guard` as an optional dep to every
 * service that has an autonomous mutation site).
 */
export function createAutonomyGuard(
  registry: ServiceRegistry,
): AutonomyGuardDeps {
  const policyService = registry.autonomy.policyService;

  // Approval-grant service — in-memory fallback until a Postgres slot is
  // added to ServiceRegistry. Audit + Inbox use the same strategy.
  const grantService = new ApprovalGrantService({
    repository: new InMemoryApprovalGrantRepository(),
  });

  const auditRecorder = createAuditTrailRecorder({
    repo: createInMemoryAuditTrailRepo(),
  });

  const exceptionInbox = new ExceptionInbox({
    repository: new InMemoryExceptionRepository(),
  });

  const onApprovalRequired: OnApprovalRequiredFn = async (input) => {
    try {
      const row = await exceptionInbox.addException({
        tenantId: input.tenantId,
        domain: input.domain,
        kind: input.actionKey,
        title: `Autonomy blocked: ${input.actionKey}`,
        description: input.decision.reason,
        evidenceRefs: [
          { kind: 'audit_trail_entry', id: input.auditEntryId },
          ...(input.grantCheck?.grantId
            ? [{ kind: 'approval_grant', id: input.grantCheck.grantId }]
            : []),
        ],
        recommendedAction: input.decision.policyRuleMatched,
      });
      return row.id;
    } catch (err) {
      logger.error('autonomy-guard: exception-inbox queue failed', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };

  const guard = withAutonomyGuard({
    policyService,
    grantService,
    auditRecorder,
    onApprovalRequired,
  });

  return { guard, grantService, auditRecorder, exceptionInbox };
}
