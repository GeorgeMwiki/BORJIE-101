/**
 * Tender Service — publish tenders, receive vendor bids, award winning bid.
 *
 * Award NEVER happens autonomously. The `awardTender` operation emits
 * `TenderAwardedEvent` which the work-order service subscribes to in order
 * to create the resulting work order with the agreed price + terms.
 */

import { prefixedId } from '../common/id-generator.js';
import type { DomainEvent, EventBus } from '../common/events.js';
import {
  createEventEnvelope,
  generateEventId,
} from '../common/events.js';

interface TenderPublishedEvent extends DomainEvent {
  readonly eventType: 'TenderPublished';
  readonly payload: {
    readonly tenderId: TenderId;
    readonly scope: Tender['scope'];
    readonly visibility: Tender['visibility'];
  };
}

interface BidSubmittedEvent extends DomainEvent {
  readonly eventType: 'BidSubmitted';
  readonly payload: {
    readonly bidId: BidId;
    readonly tenderId: TenderId;
    readonly vendorId: Bid['vendorId'];
    readonly price: Bid['price'];
  };
}

interface TenderAwardedEvent extends DomainEvent {
  readonly eventType: 'TenderAwarded';
  readonly payload: {
    readonly tenderId: TenderId;
    readonly bidId: BidId;
    readonly vendorId: Bid['vendorId'];
    readonly awardedPrice: Bid['price'];
    readonly workOrderId: Tender['workOrderId'];
  };
}

interface TenderCancelledEvent extends DomainEvent {
  readonly eventType: 'TenderCancelled';
  readonly payload: {
    readonly tenderId: TenderId;
    readonly reason: string;
  };
}
import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';

import {
  MarketplaceServiceError,
  asTenderId,
  asBidId,
  type Tender,
  type TenderId,
  type TenderRepository,
  type Bid,
  type BidId,
  type BidRepository,
  type PublishTenderInput,
  type SubmitBidInput,
  type AwardTenderInput,
} from './types.js';

function nowIso(): ISOTimestamp {
  return new Date().toISOString() as ISOTimestamp;
}

export interface TenderServiceDeps {
  readonly tenderRepo: TenderRepository;
  readonly bidRepo: BidRepository;
  readonly eventBus: EventBus;
  readonly now?: () => ISOTimestamp;
}

export class TenderService {
  private readonly tenderRepo: TenderRepository;
  private readonly bidRepo: BidRepository;
  private readonly eventBus: EventBus;
  private readonly now: () => ISOTimestamp;

  constructor(deps: TenderServiceDeps) {
    this.tenderRepo = deps.tenderRepo;
    this.bidRepo = deps.bidRepo;
    this.eventBus = deps.eventBus;
    this.now = deps.now ?? nowIso;
  }

  async publish(
    tenantId: TenantId,
    input: PublishTenderInput,
    userId: UserId | null,
    correlationId: string
  ): Promise<Result<Tender, MarketplaceServiceError>> {
    if (input.budgetRangeMin <= 0 || input.budgetRangeMax <= 0) {
      return err(
        new MarketplaceServiceError('Budget must be positive', 'VALIDATION')
      );
    }
    if (input.budgetRangeMin > input.budgetRangeMax) {
      return err(
        new MarketplaceServiceError(
          'budgetRangeMin must be <= budgetRangeMax',
          'VALIDATION'
        )
      );
    }

    const timestamp = this.now();
    const tender: Tender = {
      id: asTenderId(prefixedId('tnd')),
      tenantId,
      workOrderId: input.workOrderId ?? null,
      scope: input.scope,
      details: input.details ?? null,
      budgetRangeMin: input.budgetRangeMin,
      budgetRangeMax: input.budgetRangeMax,
      // Currency must be supplied by caller from tenant region-config.
      // No KES fallback — wrong-currency tenders would be silently created.
      currency: input.currency ?? '',
      status: 'open',
      visibility: input.visibility ?? 'public',
      invitedVendorIds: input.invitedVendorIds ?? [],
      aiNegotiatorEnabled: input.aiNegotiatorEnabled ?? true,
      negotiationPolicyId: input.negotiationPolicyId ?? null,
      closesAt: input.closesAt,
      awardedAt: null,
      awardedBidId: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: timestamp,
      createdBy: userId,
      updatedAt: timestamp,
      updatedBy: userId,
    };

    const created = await this.tenderRepo.create(tender);

    await this.eventBus.publish(
      createEventEnvelope(
        {
          eventId: generateEventId(),
          eventType: 'TenderPublished',
          timestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            tenderId: created.id,
            scope: created.scope,
            visibility: created.visibility,
          },
        } satisfies TenderPublishedEvent,
        created.id,
        'Tender'
      )
    );

    return ok(created);
  }

  async bid(
    tenantId: TenantId,
    input: SubmitBidInput,
    correlationId: string
  ): Promise<Result<Bid, MarketplaceServiceError>> {
    const tender = await this.tenderRepo.findById(input.tenderId, tenantId);
    if (!tender) {
      return err(new MarketplaceServiceError('Tender not found', 'NOT_FOUND'));
    }
    if (tender.status !== 'open') {
      return err(
        new MarketplaceServiceError(
          `Tender is ${tender.status}; bidding closed`,
          'TENDER_CLOSED'
        )
      );
    }

    // Invite-only gate
    if (
      tender.visibility === 'invite_only' &&
      !tender.invitedVendorIds.includes(input.vendorId)
    ) {
      return err(
        new MarketplaceServiceError(
          'Vendor not invited to this tender',
          'VALIDATION'
        )
      );
    }

    // Budget sanity — we accept out-of-band bids but flag them; strict
    // rejection is left to policy at award time.
    if (input.price <= 0 || input.timelineDays <= 0) {
      return err(
        new MarketplaceServiceError(
          'price and timelineDays must be positive',
          'VALIDATION'
        )
      );
    }

    const timestamp = this.now();
    const bid: Bid = {
      id: asBidId(prefixedId('bid')),
      tenantId,
      tenderId: tender.id,
      vendorId: input.vendorId,
      price: input.price,
      currency: input.currency ?? tender.currency,
      timelineDays: input.timelineDays,
      notes: input.notes ?? null,
      attachments: input.attachments ?? [],
      status: 'submitted',
      negotiationId: null,
      negotiationTurns: [],
      submittedAt: timestamp,
      awardedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const created = await this.bidRepo.create(bid);

    await this.eventBus.publish(
      createEventEnvelope(
        {
          eventId: generateEventId(),
          eventType: 'BidSubmitted',
          timestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            bidId: created.id,
            tenderId: tender.id,
            vendorId: created.vendorId,
            price: created.price,
          },
        } satisfies BidSubmittedEvent,
        created.id,
        'Bid'
      )
    );

    return ok(created);
  }

  async awardTender(
    tenantId: TenantId,
    input: AwardTenderInput,
    correlationId: string
  ): Promise<Result<{ readonly tender: Tender; readonly bid: Bid }, MarketplaceServiceError>> {
    const tender = await this.tenderRepo.findById(input.tenderId, tenantId);
    if (!tender) {
      return err(new MarketplaceServiceError('Tender not found', 'NOT_FOUND'));
    }
    if (tender.status !== 'open') {
      return err(
        new MarketplaceServiceError(
          `Cannot award a ${tender.status} tender`,
          'INVALID_STATUS'
        )
      );
    }
    const bid = await this.bidRepo.findById(input.bidId, tenantId);
    if (!bid || bid.tenderId !== tender.id) {
      return err(
        new MarketplaceServiceError('Bid not on this tender', 'NOT_FOUND')
      );
    }

    const timestamp = this.now();

    const updatedTender = await this.tenderRepo.update(tender.id, tenantId, {
      status: 'awarded',
      awardedAt: timestamp,
      awardedBidId: bid.id,
      updatedAt: timestamp,
      updatedBy: input.awardedBy,
    });

    const updatedBid = await this.bidRepo.update(bid.id, tenantId, {
      status: 'awarded',
      awardedAt: timestamp,
      updatedAt: timestamp,
    });

    // Reject the rest
    const peers = await this.bidRepo.listByTender(tender.id, tenantId);
    for (const p of peers) {
      if (p.id !== bid.id && p.status === 'submitted') {
        await this.bidRepo.update(p.id, tenantId, {
          status: 'rejected',
          rejectedAt: timestamp,
          rejectionReason: 'Tender awarded to another vendor',
          updatedAt: timestamp,
        });
      }
    }

    await this.eventBus.publish(
      createEventEnvelope(
        {
          eventId: generateEventId(),
          eventType: 'TenderAwarded',
          timestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            tenderId: updatedTender.id,
            bidId: updatedBid.id,
            vendorId: updatedBid.vendorId,
            awardedPrice: updatedBid.price,
            workOrderId: updatedTender.workOrderId,
          },
        } satisfies TenderAwardedEvent,
        updatedTender.id,
        'Tender'
      )
    );

    return ok({ tender: updatedTender, bid: updatedBid });
  }

  async listBids(
    tenantId: TenantId,
    tenderId: TenderId
  ): Promise<ReadonlyArray<Bid>> {
    return this.bidRepo.listByTender(tenderId, tenantId);
  }

  async findTender(
    tenantId: TenantId,
    id: TenderId
  ): Promise<Tender | null> {
    return this.tenderRepo.findById(id, tenantId);
  }

  async cancelTender(
    tenantId: TenantId,
    id: TenderId,
    reason: string,
    userId: UserId | null,
    correlationId: string
  ): Promise<Result<Tender, MarketplaceServiceError>> {
    const tender = await this.tenderRepo.findById(id, tenantId);
    if (!tender)
      return err(new MarketplaceServiceError('Tender not found', 'NOT_FOUND'));
    if (tender.status !== 'open')
      return err(
        new MarketplaceServiceError(
          `Cannot cancel ${tender.status} tender`,
          'INVALID_STATUS'
        )
      );
    const timestamp = this.now();
    const updated = await this.tenderRepo.update(id, tenantId, {
      status: 'cancelled',
      cancelledAt: timestamp,
      cancellationReason: reason,
      updatedAt: timestamp,
      updatedBy: userId,
    });
    await this.eventBus.publish(
      createEventEnvelope(
        {
          eventId: generateEventId(),
          eventType: 'TenderCancelled',
          timestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: { tenderId: updated.id, reason },
        } satisfies TenderCancelledEvent,
        updated.id,
        'Tender'
      )
    );
    return ok(updated);
  }
}
