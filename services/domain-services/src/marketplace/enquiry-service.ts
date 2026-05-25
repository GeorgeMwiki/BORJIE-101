/**
 * Enquiry Service — thin coordinator between a marketplace listing and
 * the Negotiation domain service.
 *
 * When a prospect hits "Start enquiry" on a listing, the app calls
 * `startEnquiry` which:
 *   1. Validates the listing is published + has a negotiation policy.
 *   2. Delegates to NegotiationService.startNegotiation().
 *   3. Emits a MarketplaceEnquiryStartedEvent.
 *
 * No AI counter is generated at enquiry time — the prospect's opening
 * message is the first turn; the AI responds only when the prospect
 * submits an actual counter.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { DomainEvent, EventBus } from '../common/events.js';
import {
  createEventEnvelope,
  generateEventId,
} from '../common/events.js';

import {
  MarketplaceServiceError,
  type MarketplaceListingId,
  type MarketplaceListingRepository,
  type StartEnquiryInput,
} from './types.js';
import type { NegotiationService } from '../negotiation/negotiation-service.js';
import {
  asNegotiationPolicyId,
  type Negotiation,
} from '../negotiation/types.js';

/**
 * Narrow read-side query surface for enquiries (which are persisted as
 * negotiations under the hood). The composition root wires a concrete
 * implementation — typically a thin Drizzle query against the
 * `negotiations` table ordered by `created_at DESC`. Kept as a duck-typed
 * dep so this package doesn't need to depend on the negotiation repo
 * directly.
 *
 * Returning `null` is a valid signal that no enquiry exists yet for the
 * given listing — callers degrade gracefully (the orchestrator stays in
 * `receiving_inquiries`).
 */
export interface EnquiryReadModel {
  /**
   * Return the most recently submitted enquiry for a listing — i.e. the
   * `prospect_customer_id` on the latest `negotiations` row keyed by
   * `(tenantId, listingId)`. Returns `null` if no enquiries exist yet.
   */
  findLatestApplicantForListing(
    tenantId: TenantId,
    listingId: MarketplaceListingId,
  ): Promise<{ readonly customerId: string } | null>;
}

export interface EnquiryServiceDeps {
  readonly listingRepo: MarketplaceListingRepository;
  readonly negotiationService: NegotiationService;
  readonly eventBus: EventBus;
  /**
   * Optional read-side query for enquiries. If not supplied, the
   * `latestApplicant` API returns `null` (no applicant available). Wire
   * a real implementation in the composition root when the read path is
   * needed (e.g. the VacancyToLeaseOrchestrator's enquiry port).
   */
  readonly readModel?: EnquiryReadModel;
}

export class EnquiryService {
  private readonly listingRepo: MarketplaceListingRepository;
  private readonly negotiationService: NegotiationService;
  private readonly eventBus: EventBus;
  private readonly readModel: EnquiryReadModel | null;

  constructor(deps: EnquiryServiceDeps) {
    this.listingRepo = deps.listingRepo;
    this.negotiationService = deps.negotiationService;
    this.eventBus = deps.eventBus;
    this.readModel = deps.readModel ?? null;
  }

  /**
   * Most recent applicant (prospect customer) for a listing within a
   * tenant. Reads from the negotiations table via the injected
   * `EnquiryReadModel`. Returns `null` when:
   *   - no `EnquiryReadModel` is wired (boot-time degraded mode), or
   *   - the listing has no enquiries yet.
   *
   * Used by the VacancyToLeaseOrchestrator's enquiry port when the
   * pipeline transitions into `receiving_inquiries` and needs to know
   * who the latest applicant is.
   */
  async latestApplicant(args: {
    readonly tenantId: TenantId;
    readonly listingId: MarketplaceListingId;
  }): Promise<{ readonly customerId: string } | null> {
    if (!this.readModel) return null;
    return this.readModel.findLatestApplicantForListing(
      args.tenantId,
      args.listingId,
    );
  }

  async startEnquiry(
    tenantId: TenantId,
    input: StartEnquiryInput,
    userId: UserId | null,
    correlationId: string
  ): Promise<Result<Negotiation, MarketplaceServiceError>> {
    const listing = await this.listingRepo.findById(input.listingId, tenantId);
    if (!listing) {
      return err(new MarketplaceServiceError('Listing not found', 'NOT_FOUND'));
    }
    if (listing.status !== 'published') {
      return err(
        new MarketplaceServiceError(
          `Listing is ${listing.status}`,
          'LISTING_NOT_PUBLISHED'
        )
      );
    }
    if (!listing.negotiationPolicyId) {
      return err(
        new MarketplaceServiceError(
          'Listing has no negotiation policy attached',
          'POLICY_REQUIRED'
        )
      );
    }

    const negResult = await this.negotiationService.startNegotiation(
      tenantId,
      {
        policyId: asNegotiationPolicyId(listing.negotiationPolicyId),
        unitId: listing.unitId,
        propertyId: listing.propertyId,
        prospectCustomerId: input.prospectCustomerId,
        listingId: listing.id,
        domain: 'lease_price',
        openingOffer: input.openingOffer,
        openingRationale: input.message,
      },
      correlationId,
      userId
    );

    if (!negResult.success) {
      return err(
        new MarketplaceServiceError(
          `Negotiation start failed: ${negResult.error.message}`,
          'VALIDATION'
        )
      );
    }

    interface MarketplaceEnquiryStartedEvent extends DomainEvent {
      readonly eventType: 'MarketplaceEnquiryStarted';
      readonly payload: {
        readonly listingId: MarketplaceListingId;
        readonly negotiationId: Negotiation['id'];
        readonly prospectCustomerId: StartEnquiryInput['prospectCustomerId'];
        readonly openingOffer: StartEnquiryInput['openingOffer'];
      };
    }
    const event: MarketplaceEnquiryStartedEvent = {
      eventId: generateEventId(),
      eventType: 'MarketplaceEnquiryStarted',
      timestamp: new Date().toISOString() as ISOTimestamp,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        listingId: listing.id,
        negotiationId: negResult.data.id,
        prospectCustomerId: input.prospectCustomerId,
        openingOffer: input.openingOffer,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(event, negResult.data.id, 'MarketplaceEnquiry')
    );

    return ok(negResult.data);
  }
}
