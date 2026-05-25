/**
 * Real adapters for the VacancyToLeaseOrchestrator.
 *
 * Wires the orchestrator's nine ports to the concrete domain services
 * that exist today. Each adapter is built on a *narrow structural type*
 * (duck-typed deps) so this package does not need a hard dependency on
 * `@borjie/domain-services`. The composition root (api-gateway)
 * passes the real service instances in; their surface only needs to
 * match the small `Real*Service` shapes declared here.
 *
 * Wiring matrix (current state of the codebase):
 *
 *   listing       — REAL_WIRED  → ListingService.publish
 *   enquiry       — REAL_WIRED  → EnquiryService.latestApplicant
 *                                 (returns the most recent
 *                                 prospect_customer_id for a listing).
 *   creditRating  — REAL_WIRED  → CreditRatingService.computeRating
 *   negotiation   — REAL_WIRED  → NegotiationService.startNegotiation
 *                                 (requires a tenant-level policy + an
 *                                 opening offer; both supplied by
 *                                 caller-provided resolvers).
 *   inspection    — REAL_WIRED  → InspectionService.scheduleInspection
 *                                 (requires propertyId + scheduledDate
 *                                 + inspectorId resolvers; falls back to
 *                                 the default if the resolver returns
 *                                 null).
 *   renewal       — REAL_WIRED  → LeaseService.seedFirstTerm
 *                                 (creates the first-term lease from
 *                                 the unit's market rent + 12-month
 *                                 default; falls back to default port
 *                                 if the lookup returns null).
 *   waitlist      — REAL_WIRED  → WaitlistService.markFilled
 *                                 (flips every active waitlist row for
 *                                 the unit to `converted`). Bare
 *                                 `markFilled` callback is also still
 *                                 accepted for back-compat.
 *   policy        — REAL_WIRED  → AutonomyPolicyService.isAuthorized
 *                                 (bound to the 'leasing' domain).
 *   events        — REAL_WIRED  → EventBus.publish (wraps payload in
 *                                 the standard EventEnvelope shape).
 *
 * Every port now has a real wiring; the conservative defaults remain as
 * boot-time fallbacks for callers who choose not to wire a slot.
 */

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
import {
  createDefaultEnquiryPort,
  createDefaultEventPort,
  createDefaultInspectionPort,
  createDefaultListingPort,
  createDefaultNegotiationPort,
  createDefaultOrchestratorAdapters,
  createDefaultPolicyPort,
  createDefaultRenewalPort,
  createDefaultWaitlistPort,
  type DefaultAdaptersDeps,
} from './default-adapters.js';

// ---------------------------------------------------------------------------
// Narrow service-shape types — duck-typed so we don't need a hard
// dependency on @borjie/domain-services or @borjie/observability.
// Each shape is the smallest subset the adapter actually invokes.
// ---------------------------------------------------------------------------

/**
 * Subset of `ListingService.publish` we depend on.
 *
 * The real service returns `Result<MarketplaceListing, MarketplaceServiceError>`.
 * We accept the broader shape and read `ok` + `value.id` defensively so the
 * adapter survives schema drift.
 */
export interface RealListingService {
  publish(
    tenantId: string,
    input: {
      readonly unitId: string;
      readonly listingKind: string;
      readonly headlinePrice: number;
      readonly currency?: string;
      readonly negotiable?: boolean;
      readonly publishImmediately?: boolean;
      readonly negotiationPolicyId?: string | null;
      readonly propertyId?: string | null;
    },
    userId: string | null,
    correlationId: string,
  ): Promise<{
    readonly ok?: boolean;
    readonly value?: { readonly id: string };
    readonly error?: { readonly message?: string };
  }>;
}

/** Subset of `CreditRatingService.computeRating`. */
export interface RealCreditRatingService {
  computeRating(
    tenantId: string,
    customerId: string,
  ): Promise<{ readonly score: number }>;
}

/** Subset of `NegotiationService.startNegotiation`. */
export interface RealNegotiationService {
  startNegotiation(
    tenantId: string,
    input: {
      readonly policyId: string;
      readonly unitId?: string | null;
      readonly propertyId?: string | null;
      readonly prospectCustomerId?: string | null;
      readonly listingId?: string | null;
      readonly domain: 'lease_price' | 'tender_bid' | string;
      readonly openingOffer: number;
      readonly openingRationale?: string | null;
    },
    correlationId: string,
    actorUserId: string | null,
  ): Promise<{
    readonly success?: boolean;
    readonly data?: { readonly id: string };
    readonly error?: { readonly message?: string };
  }>;
}

/** Subset of `InspectionService.scheduleInspection`. */
export interface RealInspectionService {
  scheduleInspection(
    tenantId: string,
    propertyId: string,
    unitId: string,
    type: string,
    scheduledDate: string,
    inspectorId?: string,
    options?: {
      readonly createdBy?: string;
      readonly correlationId?: string;
      readonly scheduledTimeSlot?: string;
    },
  ): Promise<{
    readonly ok?: boolean;
    readonly value?: { readonly id: string };
    readonly error?: { readonly message?: string };
  }>;
}

/** Subset of `AutonomyPolicyService.isAuthorized`. */
export interface RealAutonomyPolicyService {
  isAuthorized(
    tenantId: string,
    domain: string,
    action: string,
    context?: Record<string, unknown>,
  ): Promise<{
    readonly authorized: boolean;
    readonly requiresApproval: boolean;
    readonly reason: string;
  }>;
}

/** Subset of `EnquiryService.latestApplicant`. */
export interface RealEnquiryService {
  latestApplicant(args: {
    readonly tenantId: string;
    readonly listingId: string;
  }): Promise<{ readonly customerId: string } | null>;
}

/**
 * Subset of `LeaseService.seedFirstTerm`.
 *
 * The real method lives on `LeaseService` (not `RenewalService`) because
 * it actually creates an *initial* lease. The orchestrator's port is
 * still named `renewal` for historical reasons; semantically it is the
 * "first-term seeder".
 */
export interface RealLeaseSeedingService {
  seedFirstTerm(args: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly customerId: string;
  }): Promise<{ readonly leaseId: string } | null>;
}

/** Subset of `WaitlistService.markFilled`. */
export interface RealWaitlistService {
  markFilled(args: {
    readonly tenantId: string;
    readonly unitId: string;
  }): Promise<void>;
}

/** Subset of an `EventBus` that accepts pre-built envelopes. */
export interface RealEventBus {
  publish(envelope: {
    readonly event: {
      readonly eventId: string;
      readonly eventType: string;
      readonly timestamp: string;
      readonly tenantId: string;
      readonly correlationId: string;
      readonly causationId: string | null;
      readonly metadata: Record<string, unknown>;
      readonly payload: Record<string, unknown>;
    };
    readonly version: number;
    readonly aggregateId: string;
    readonly aggregateType: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Resolver shapes — the orchestrator's port signatures don't carry every
// argument the underlying services need (e.g. propertyId for inspection,
// policyId for negotiation). The composition root supplies a small
// resolver per gap; if the resolver returns null/undefined the adapter
// transparently falls back to the conservative default.
// ---------------------------------------------------------------------------

export interface RealListingHints {
  /** Asking rent for the unit. Used as `headlinePrice` on the listing. */
  resolveHeadlinePrice(
    tenantId: string,
    unitId: string,
  ): Promise<number | null>;
  /** Tenant-region currency code (e.g. KES, TZS). */
  resolveCurrency(tenantId: string): Promise<string | null>;
  /** Optional negotiation policy to pre-attach. */
  resolveNegotiationPolicyId?(
    tenantId: string,
    unitId: string,
  ): Promise<string | null>;
  /** Property id when known up-front. */
  resolvePropertyId?(
    tenantId: string,
    unitId: string,
  ): Promise<string | null>;
  /** Listing kind override; defaults to `unit_for_rent`. */
  listingKind?: string;
}

export interface RealNegotiationHints {
  /**
   * Active negotiation policy for offers on this listing. The
   * orchestrator port carries `listingId` (not `unitId`) so the
   * resolver receives that — most implementations join through the
   * listing row to read the attached `negotiation_policy_id`.
   */
  resolvePolicyId(tenantId: string, listingId: string): Promise<string | null>;
  /** Opening offer (typically the listing's headlinePrice). */
  resolveOpeningOffer(
    tenantId: string,
    listingId: string,
    customerId: string,
  ): Promise<number | null>;
}

export interface RealInspectionHints {
  /** Resolve property id from the unit (FK lookup). */
  resolvePropertyId(tenantId: string, unitId: string): Promise<string | null>;
  /** ISO date for the move-in inspection. */
  resolveScheduledDate(
    tenantId: string,
    unitId: string,
    customerId: string,
  ): Promise<string | null>;
  /** Inspector to assign — typically the unit's estate manager. */
  resolveInspectorId(
    tenantId: string,
    unitId: string,
  ): Promise<string | null>;
  /** Inspection type override; defaults to `move_in`. */
  inspectionType?: string;
}

/** Optional first-class `markUnitFilled` callback for the waitlist port. */
export interface RealWaitlistMarkFilled {
  (tenantId: string, unitId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Per-port factories. Each accepts the relevant real service + (optional)
// resolvers and falls back to the conservative default when the
// underlying call fails or a resolver returns null.
// ---------------------------------------------------------------------------

const DEFAULT_LISTING_KIND = 'unit_for_rent';
const DEFAULT_INSPECTION_TYPE = 'move_in';

/**
 * Builds a `OrchestratorListingPort` backed by `ListingService.publish`.
 * Falls back to the synthetic-id default when the resolver cannot
 * provide an `headlinePrice` (publishing without one would be a
 * VALIDATION error from the real service).
 */
export function createRealListingAdapter(deps: {
  readonly service: RealListingService;
  readonly hints: RealListingHints;
  readonly defaults?: DefaultAdaptersDeps;
}): OrchestratorListingPort {
  const fallback = createDefaultListingPort(deps.defaults ?? {});
  return {
    async publishListing(tenantId, unitId, initiatedBy, correlationId) {
      const headlinePrice = await deps.hints.resolveHeadlinePrice(
        tenantId,
        unitId,
      );
      if (headlinePrice == null || headlinePrice <= 0) {
        return fallback.publishListing(tenantId, unitId, initiatedBy, correlationId);
      }
      const currency = (await deps.hints.resolveCurrency(tenantId)) ?? '';
      const negotiationPolicyId = deps.hints.resolveNegotiationPolicyId
        ? await deps.hints.resolveNegotiationPolicyId(tenantId, unitId)
        : null;
      const propertyId = deps.hints.resolvePropertyId
        ? await deps.hints.resolvePropertyId(tenantId, unitId)
        : null;

      const result = await deps.service.publish(
        tenantId,
        {
          unitId,
          listingKind: deps.hints.listingKind ?? DEFAULT_LISTING_KIND,
          headlinePrice,
          currency,
          negotiable: true,
          publishImmediately: true,
          negotiationPolicyId,
          propertyId,
        },
        initiatedBy,
        correlationId,
      );

      const listing = result?.ok ? result.value : null;
      if (!listing?.id) {
        throw new Error(
          result?.error?.message ?? 'ListingService.publish returned no listing',
        );
      }
      return { listingId: listing.id };
    },
  };
}

/**
 * Builds a `OrchestratorCreditRatingPort` backed by
 * `CreditRatingService.computeRating`. Errors propagate so the
 * orchestrator can surface SIDE_EFFECT_FAILED.
 */
export function createRealCreditRatingAdapter(deps: {
  readonly service: RealCreditRatingService;
}): OrchestratorCreditRatingPort {
  return {
    async score(tenantId, customerId) {
      const rating = await deps.service.computeRating(tenantId, customerId);
      return { score: rating.score };
    },
  };
}

/**
 * Builds a `OrchestratorNegotiationPort` backed by
 * `NegotiationService.startNegotiation`. Falls back to the default
 * when policyId or openingOffer cannot be resolved (the real service
 * requires both).
 */
export function createRealNegotiationAdapter(deps: {
  readonly service: RealNegotiationService;
  readonly hints: RealNegotiationHints;
  readonly defaults?: DefaultAdaptersDeps;
}): OrchestratorNegotiationPort {
  const fallback = createDefaultNegotiationPort(deps.defaults ?? {});
  return {
    async proposeOffer(tenantId, listingId, customerId, initiatedBy) {
      const [policyId, openingOffer] = await Promise.all([
        deps.hints.resolvePolicyId(tenantId, listingId),
        deps.hints.resolveOpeningOffer(tenantId, listingId, customerId),
      ]);
      if (!policyId || openingOffer == null || openingOffer <= 0) {
        return fallback.proposeOffer(tenantId, listingId, customerId, initiatedBy);
      }

      const result = await deps.service.startNegotiation(
        tenantId,
        {
          policyId,
          listingId,
          prospectCustomerId: customerId,
          domain: 'lease_price',
          openingOffer,
        },
        `vpr_${Date.now()}`,
        initiatedBy,
      );

      const negotiation = result?.success ? result.data : null;
      if (!negotiation?.id) {
        throw new Error(
          result?.error?.message ?? 'NegotiationService.startNegotiation returned no negotiation',
        );
      }
      return { negotiationId: negotiation.id };
    },
  };
}

/**
 * Builds a `OrchestratorInspectionPort` backed by
 * `InspectionService.scheduleInspection`. Falls back to the default
 * when resolvers cannot supply propertyId / scheduledDate / inspectorId.
 */
export function createRealInspectionAdapter(deps: {
  readonly service: RealInspectionService;
  readonly hints: RealInspectionHints;
  readonly defaults?: DefaultAdaptersDeps;
}): OrchestratorInspectionPort {
  const fallback = createDefaultInspectionPort(deps.defaults ?? {});
  return {
    async scheduleMoveInInspection(tenantId, unitId, customerId) {
      const [propertyId, scheduledDate, inspectorId] = await Promise.all([
        deps.hints.resolvePropertyId(tenantId, unitId),
        deps.hints.resolveScheduledDate(tenantId, unitId, customerId),
        deps.hints.resolveInspectorId(tenantId, unitId),
      ]);
      if (!propertyId || !scheduledDate || !inspectorId) {
        return fallback.scheduleMoveInInspection(tenantId, unitId, customerId);
      }
      const result = await deps.service.scheduleInspection(
        tenantId,
        propertyId,
        unitId,
        deps.hints.inspectionType ?? DEFAULT_INSPECTION_TYPE,
        scheduledDate,
        inspectorId,
        { createdBy: inspectorId },
      );
      const inspection = result?.ok ? result.value : null;
      if (!inspection?.id) {
        throw new Error(
          result?.error?.message ??
            'InspectionService.scheduleInspection returned no inspection',
        );
      }
      return { inspectionId: inspection.id };
    },
  };
}

/**
 * Builds a `OrchestratorPolicyPort` backed by
 * `AutonomyPolicyService.isAuthorized`, bound to the `'leasing'` domain.
 * The orchestrator's autonomy actions
 * (`publish_listing`, `approve_application`, `send_offer_letter`,
 * `approve_renewal`) are the documented leasing actions.
 */
export function createRealPolicyAdapter(deps: {
  readonly service: RealAutonomyPolicyService;
  readonly domain?: string;
}): OrchestratorPolicyPort {
  const domain = deps.domain ?? 'leasing';
  return {
    async isAuthorized(tenantId, action, context) {
      const decision = await deps.service.isAuthorized(
        tenantId,
        domain,
        action,
        context,
      );
      return {
        authorized: decision.authorized,
        requiresApproval: decision.requiresApproval,
        reason: decision.reason,
      };
    },
  };
}

/**
 * Builds a `OrchestratorEventPort` backed by an `EventBus.publish`.
 * Wraps the orchestrator's flat event payload in the EventEnvelope
 * shape (`event`, `version`, `aggregateId`, `aggregateType`) the
 * downstream observability + audit-trail subscribers expect.
 *
 * Bus failures are swallowed (orchestrator transitions must never be
 * blocked by an event-bus outage); the optional `onError` hook lets
 * the caller surface them in telemetry.
 */
export function createRealEventAdapter(deps: {
  readonly bus: RealEventBus;
  readonly correlationId?: () => string;
  readonly eventId?: () => string;
  readonly now?: () => string;
  readonly aggregateType?: string;
  readonly onError?: (err: unknown) => void;
}): OrchestratorEventPort {
  const correlationId = deps.correlationId ?? (() => `vp_corr_${Date.now()}`);
  const eventId = deps.eventId ?? (() => `evt_vp_${Date.now()}`);
  const now = deps.now ?? (() => new Date().toISOString());
  const aggregateType = deps.aggregateType ?? 'VacancyPipelineRun';

  return {
    async emit(event) {
      try {
        await deps.bus.publish({
          event: {
            eventId: eventId(),
            eventType: event.eventType,
            timestamp: now(),
            tenantId: event.tenantId,
            correlationId: correlationId(),
            causationId: null,
            metadata: {},
            payload: {
              runId: event.runId,
              unitId: event.unitId,
              state: event.state,
              ...event.payload,
            },
          },
          version: 1,
          aggregateId: event.runId,
          aggregateType,
        });
      } catch (err) {
        deps.onError?.(err);
        // Never let a bus failure tear down the transition.
      }
    },
  };
}

/**
 * Builds an `OrchestratorEnquiryPort` backed by
 * `EnquiryService.latestApplicant`. The service returns `null` when the
 * listing has no enquiries yet — the orchestrator port contract accepts
 * that as a valid "no applicant available" signal so the state machine
 * stays in `receiving_inquiries`.
 */
export function createRealEnquiryAdapter(deps: {
  readonly service: RealEnquiryService;
}): OrchestratorEnquiryPort {
  return {
    async latestApplicant(tenantId, listingId) {
      const result = await deps.service.latestApplicant({ tenantId, listingId });
      return result ? { customerId: result.customerId } : null;
    },
  };
}

/**
 * Builds an `OrchestratorRenewalPort` backed by
 * `LeaseService.seedFirstTerm` (the underlying call lives on the lease
 * service even though the port is historically named "renewal" — see
 * the `RealLeaseSeedingService` doc comment).
 *
 * Falls back to the default port (returns `{ leaseId: null }`) when the
 * service returns `null` — typically because the unit is not yet priced
 * or the unit lookup is not wired. The orchestrator's `move_in_scheduled`
 * branch is tolerant of a missing leaseId.
 */
export function createRealRenewalAdapter(deps: {
  readonly service: RealLeaseSeedingService;
  readonly defaults?: DefaultAdaptersDeps;
}): OrchestratorRenewalPort {
  const fallback = createDefaultRenewalPort(deps.defaults ?? {});
  return {
    async seedFirstTerm(tenantId, unitId, customerId) {
      const result = await deps.service.seedFirstTerm({
        tenantId,
        unitId,
        customerId,
      });
      if (!result) return fallback.seedFirstTerm(tenantId, unitId, customerId);
      return { leaseId: result.leaseId };
    },
  };
}

/**
 * Builds an `OrchestratorWaitlistPort` backed by either
 * `WaitlistService.markFilled` (preferred) or a bare callback. The
 * `markFilled` callback shape is preserved for backwards compatibility
 * with composition roots wiring custom logic; when both are supplied,
 * the real service wins.
 *
 * If neither is supplied the default no-op port is returned so existing
 * behaviour is preserved.
 */
export function createRealWaitlistAdapter(deps: {
  readonly service?: RealWaitlistService;
  readonly markFilled?: RealWaitlistMarkFilled;
  readonly defaults?: DefaultAdaptersDeps;
}): OrchestratorWaitlistPort {
  const fallback = createDefaultWaitlistPort(deps.defaults ?? {});
  if (deps.service) {
    const service = deps.service;
    return {
      async markUnitFilled(tenantId, unitId) {
        await service.markFilled({ tenantId, unitId });
      },
    };
  }
  if (!deps.markFilled) return fallback;
  const markFilled = deps.markFilled;
  return {
    async markUnitFilled(tenantId, unitId) {
      await markFilled(tenantId, unitId);
    },
  };
}

// ---------------------------------------------------------------------------
// Composite bundle — the production composition root passes whatever
// services it has wired and gets a partial adapter set; missing ports
// fall through to the conservative defaults.
// ---------------------------------------------------------------------------

export interface RealOrchestratorAdaptersDeps {
  readonly listing?: {
    readonly service: RealListingService;
    readonly hints: RealListingHints;
  };
  readonly enquiry?: {
    readonly service: RealEnquiryService;
  };
  readonly creditRating?: {
    readonly service: RealCreditRatingService;
  };
  readonly negotiation?: {
    readonly service: RealNegotiationService;
    readonly hints: RealNegotiationHints;
  };
  readonly inspection?: {
    readonly service: RealInspectionService;
    readonly hints: RealInspectionHints;
  };
  readonly renewal?: {
    readonly service: RealLeaseSeedingService;
  };
  readonly policy?: {
    readonly service: RealAutonomyPolicyService;
    readonly domain?: string;
  };
  readonly events?: {
    readonly bus: RealEventBus;
    readonly correlationId?: () => string;
    readonly eventId?: () => string;
    readonly now?: () => string;
    readonly aggregateType?: string;
    readonly onError?: (err: unknown) => void;
  };
  readonly waitlist?: {
    readonly service?: RealWaitlistService;
    readonly markFilled?: RealWaitlistMarkFilled;
  };
  readonly defaults?: DefaultAdaptersDeps;
}

/**
 * Builds the full set of orchestrator adapters using real domain
 * services where deps are supplied, falling back to the conservative
 * defaults for everything else (enquiry, renewal, and any port whose
 * `service` slot is omitted).
 *
 * Compose at the api-gateway composition root:
 *
 *   const adapters = createRealOrchestratorAdapters({
 *     listing: { service: listingService, hints },
 *     creditRating: { service: creditRatingService },
 *     policy: { service: autonomyPolicyService },
 *     events: { bus: eventBus },
 *   });
 *   const orchestrator = new VacancyToLeaseOrchestrator({
 *     ...adapters,
 *     repo: pgVacancyPipelineRepo,
 *   });
 */
export function createRealOrchestratorAdapters(
  deps: RealOrchestratorAdaptersDeps,
): Omit<VacancyToLeaseOrchestratorDeps, 'repo'> {
  const defaultsBundle = createDefaultOrchestratorAdapters(deps.defaults ?? {});

  return {
    listing: deps.listing
      ? createRealListingAdapter({
          service: deps.listing.service,
          hints: deps.listing.hints,
          defaults: deps.defaults,
        })
      : defaultsBundle.listing,
    enquiry: deps.enquiry
      ? createRealEnquiryAdapter({ service: deps.enquiry.service })
      : defaultsBundle.enquiry,
    creditRating: deps.creditRating
      ? createRealCreditRatingAdapter({ service: deps.creditRating.service })
      : defaultsBundle.creditRating,
    negotiation: deps.negotiation
      ? createRealNegotiationAdapter({
          service: deps.negotiation.service,
          hints: deps.negotiation.hints,
          defaults: deps.defaults,
        })
      : defaultsBundle.negotiation,
    inspection: deps.inspection
      ? createRealInspectionAdapter({
          service: deps.inspection.service,
          hints: deps.inspection.hints,
          defaults: deps.defaults,
        })
      : defaultsBundle.inspection,
    renewal: deps.renewal
      ? createRealRenewalAdapter({
          service: deps.renewal.service,
          defaults: deps.defaults,
        })
      : defaultsBundle.renewal,
    waitlist:
      deps.waitlist?.service || deps.waitlist?.markFilled
        ? createRealWaitlistAdapter({
            service: deps.waitlist.service,
            markFilled: deps.waitlist.markFilled,
            defaults: deps.defaults,
          })
        : defaultsBundle.waitlist,
    policy: deps.policy
      ? createRealPolicyAdapter({
          service: deps.policy.service,
          domain: deps.policy.domain,
        })
      : defaultsBundle.policy,
    events: deps.events
      ? createRealEventAdapter({
          bus: deps.events.bus,
          correlationId: deps.events.correlationId,
          eventId: deps.events.eventId,
          now: deps.events.now,
          aggregateType: deps.events.aggregateType,
          onError: deps.events.onError,
        })
      : defaultsBundle.events,
  };
}

// Re-exports so test files only need to import the file once.
export {
  createDefaultEnquiryPort,
  createDefaultRenewalPort,
  createDefaultPolicyPort,
  createDefaultEventPort,
};
