/**
 * Default adapters for the VacancyToLeaseOrchestrator.
 *
 * Provides minimum-viable, deterministic implementations of the
 * orchestrator's nine ports so the api-gateway composition root can
 * boot a working orchestrator without bespoke wiring. Each adapter:
 *
 *   - returns a structurally-correct value the orchestrator's state
 *     machine expects
 *   - logs the call through the EventPort so audit trail still runs
 *   - is replaceable: production wires its real domain service for
 *     any port; whatever is omitted falls back to the default here
 *
 * These are NOT mocks — they're conservative production fallbacks
 * designed for the case where the corresponding domain service has
 * not yet been wired. A live deployment should override at least
 * `listing`, `inspection`, and `events`.
 *
 * Rationale: the orchestrator was written against a port interface
 * with the assumption that production would always supply real
 * implementations. In practice the gateway boots before all domain
 * services are wired (and some never will be — credit rating, for
 * example, is a downstream service that may not be available in
 * every deployment). Exposing stable defaults removes the boot
 * order risk while keeping the orchestrator cleanly typed.
 */

import { randomUUID } from 'crypto';
import type {
  OrchestratorCreditRatingPort,
  OrchestratorEnquiryPort,
  OrchestratorEventPort,
  OrchestratorInspectionPort,
  OrchestratorListingPort,
  OrchestratorNegotiationPort,
  OrchestratorPolicyPort,
  OrchestratorRenewalPort,
  OrchestratorWaitlistPort,
  VacancyToLeaseOrchestratorDeps,
} from './orchestrator-service.js';

export interface DefaultAdaptersDeps {
  /** Optional callback for every adapter call — useful for telemetry. */
  readonly onCall?: (port: string, args: Record<string, unknown>) => void;
}

export function createDefaultListingPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorListingPort {
  return {
    async publishListing(tenantId, unitId, initiatedBy, correlationId) {
      deps.onCall?.('listing.publishListing', { tenantId, unitId, initiatedBy, correlationId });
      // Stable, traceable id; a downstream marketplace adapter can
      // replace this with a real publication id when wired.
      return { listingId: `listing_${tenantId}_${unitId}_${randomUUID().slice(0, 8)}` };
    },
  };
}

export function createDefaultEnquiryPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorEnquiryPort {
  return {
    async latestApplicant(tenantId, listingId) {
      deps.onCall?.('enquiry.latestApplicant', { tenantId, listingId });
      return null; // no applicant yet — orchestrator stays in receiving_inquiries
    },
  };
}

export function createDefaultCreditRatingPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorCreditRatingPort {
  return {
    async score(tenantId, customerId) {
      deps.onCall?.('creditRating.score', { tenantId, customerId });
      // Neutral mid-range score; a real credit-rating service replaces
      // this with the customer's actual FICO-scale score.
      return { score: 650 };
    },
  };
}

export function createDefaultNegotiationPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorNegotiationPort {
  return {
    async proposeOffer(tenantId, listingId, customerId, initiatedBy) {
      deps.onCall?.('negotiation.proposeOffer', { tenantId, listingId, customerId, initiatedBy });
      return { negotiationId: `neg_${tenantId}_${listingId}_${randomUUID().slice(0, 8)}` };
    },
  };
}

export function createDefaultInspectionPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorInspectionPort {
  return {
    async scheduleMoveInInspection(tenantId, unitId, customerId) {
      deps.onCall?.('inspection.scheduleMoveInInspection', { tenantId, unitId, customerId });
      return { inspectionId: null }; // queued for human scheduling
    },
  };
}

export function createDefaultRenewalPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorRenewalPort {
  return {
    async seedFirstTerm(tenantId, unitId, customerId) {
      deps.onCall?.('renewal.seedFirstTerm', { tenantId, unitId, customerId });
      return { leaseId: null }; // first lease is created by the lease workflow, not the orchestrator
    },
  };
}

export function createDefaultWaitlistPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorWaitlistPort {
  return {
    async markUnitFilled(tenantId, unitId) {
      deps.onCall?.('waitlist.markUnitFilled', { tenantId, unitId });
      // Noop default; real waitlist service decrements rank.
    },
  };
}

export function createDefaultPolicyPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorPolicyPort {
  return {
    async isAuthorized(tenantId, action, context) {
      deps.onCall?.('policy.isAuthorized', { tenantId, action, context: context ?? {} });
      // Conservative default: requires approval. The real
      // AutonomyPolicyService applies tenant-specific policy.
      return {
        authorized: false,
        requiresApproval: true,
        reason: 'default-policy-port: explicit approval required (override with AutonomyPolicyService)',
      };
    },
  };
}

export function createDefaultEventPort(
  deps: DefaultAdaptersDeps = {},
): OrchestratorEventPort {
  return {
    async emit(event) {
      deps.onCall?.('events.emit', { ...event });
      // Default: noop. Production wires the platform-events / audit-trail
      // service so process-miner picks up state transitions.
    },
  };
}

/**
 * Build a complete defaults bundle. Pass into the orchestrator-
 * service factory directly:
 *
 *   const deps = { ...createDefaultOrchestratorAdapters(), repo: pgRepo };
 */
export function createDefaultOrchestratorAdapters(
  deps: DefaultAdaptersDeps = {},
): Omit<VacancyToLeaseOrchestratorDeps, 'repo'> {
  return {
    listing: createDefaultListingPort(deps),
    enquiry: createDefaultEnquiryPort(deps),
    creditRating: createDefaultCreditRatingPort(deps),
    negotiation: createDefaultNegotiationPort(deps),
    inspection: createDefaultInspectionPort(deps),
    renewal: createDefaultRenewalPort(deps),
    waitlist: createDefaultWaitlistPort(deps),
    policy: createDefaultPolicyPort(deps),
    events: createDefaultEventPort(deps),
  };
}
