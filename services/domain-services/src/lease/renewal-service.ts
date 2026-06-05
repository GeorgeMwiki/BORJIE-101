/**
 * Offtake Renewal Service
 *
 * Explicit renewal lifecycle on top of the existing `OfftakeService`.
 * Handles five transitions:
 *
 *   1. openRenewalWindow  — moves offtake to `window_opened` and emits
 *                           `RenewalWindowOpened`.
 *   2. proposeRenewal     — records proposed royalty and emits
 *                           `RenewalProposed`.
 *   3. acceptRenewal      — creates a NEW offtake row (immutable old offtake
 *                           retained for audit) and emits `RenewalAccepted`.
 *   4. declineRenewal     — marks old offtake `declined` and emits
 *                           `RenewalDeclined`.
 *   5. terminate          — terminates offtake outside of renewal path and
 *                           emits `LeaseTerminatedByRenewal`.
 *
 * The service is transport-agnostic and depends only on a repository + event
 * bus. It does not mutate the old offtake on accept — instead a linked new
 * offtake row is inserted and `renewedToOfftakeId` is stamped on the old.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';
import type { EventBus, DomainEvent } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import { randomHex } from '../common/id-generator.js';

// ---------------------------------------------------------------------------
// Domain model (deliberately narrow — we don't re-import the Offtake aggregate
// to avoid cross-module drift in the offtake barrel).
// ---------------------------------------------------------------------------

export type OfftakeRenewalStatus =
  | 'not_started'
  | 'window_opened'
  | 'proposed'
  | 'accepted'
  | 'declined'
  | 'terminated'
  | 'expired';

/** @deprecated Use {@link OfftakeRenewalStatus}. */
export type LeaseRenewalStatus = OfftakeRenewalStatus;

export interface RenewalOfftakeSnapshot {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly offtakeNumber: string;
  readonly propertyId: string;
  readonly unitId: string;
  readonly customerId: string;
  readonly startDate: ISOTimestamp;
  readonly endDate: ISOTimestamp | null;
  readonly royaltyAmount: number;
  readonly royaltyCurrency: string;
  readonly renewalStatus: OfftakeRenewalStatus;
  readonly renewalWindowOpenedAt: ISOTimestamp | null;
  readonly renewalProposedAt: ISOTimestamp | null;
  readonly renewalProposedRoyalty: number | null;
  readonly renewalDecidedAt: ISOTimestamp | null;
  readonly renewalDecisionBy: UserId | null;
  readonly terminationDate: ISOTimestamp | null;
  readonly terminationReasonNotes: string | null;
}

/**
 * @deprecated Use {@link RenewalOfftakeSnapshot}. Retained because
 * off-limits importers (api-gateway composition root) reference this name
 * in their `RenewalRepository` stub signatures.
 */
export type RenewalLeaseSnapshot = RenewalOfftakeSnapshot;

export interface RenewalRepository {
  findById(id: string, tenantId: TenantId): Promise<RenewalOfftakeSnapshot | null>;
  update(offtake: RenewalOfftakeSnapshot): Promise<RenewalOfftakeSnapshot>;
  // NOTE (cross-package contract): `createRenewedLease` + `nextLeaseSequence`
  // method names are implemented by the api-gateway composition-root stub
  // (off-limits). Their names are frozen; only the param/field semantics
  // migrate to the offtake domain.
  createRenewedLease(params: {
    fromOfftakeId: string;
    tenantId: TenantId;
    newOfftakeId: string;
    newOfftakeNumber: string;
    startDate: ISOTimestamp;
    endDate: ISOTimestamp;
    royaltyAmount: number;
    royaltyCurrency: string;
    createdBy: UserId;
  }): Promise<RenewalOfftakeSnapshot>;
  nextLeaseSequence(tenantId: TenantId): Promise<number>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const RenewalServiceError = {
  OFFTAKE_NOT_FOUND: 'OFFTAKE_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type RenewalServiceErrorCode =
  (typeof RenewalServiceError)[keyof typeof RenewalServiceError];

export interface RenewalServiceErrorResult {
  code: RenewalServiceErrorCode;
  message: string;
}

function err<T>(
  code: RenewalServiceErrorCode,
  message: string,
): Result<T, RenewalServiceErrorResult> {
  return {
    success: false,
    ok: false,
    error: { code, message },
  } as Result<T, RenewalServiceErrorResult>;
}

function ok<T>(value: T): Result<T, RenewalServiceErrorResult> {
  return {
    success: true,
    ok: true,
    data: value,
    value,
  } as Result<T, RenewalServiceErrorResult>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

interface RenewalEventBase extends DomainEvent {
  readonly tenantId: TenantId;
}

export interface RenewalWindowOpenedEvent extends RenewalEventBase {
  readonly eventType: 'RenewalWindowOpened';
  readonly payload: {
    readonly offtakeId: string;
    readonly offtakeNumber: string;
    readonly customerId: string;
    readonly endDate: ISOTimestamp | null;
    readonly openedBy: UserId;
  };
}

export interface RenewalProposedEvent extends RenewalEventBase {
  readonly eventType: 'RenewalProposed';
  readonly payload: {
    readonly offtakeId: string;
    readonly proposedRoyalty: number;
    readonly proposedBy: UserId;
  };
}

export interface RenewalAcceptedEvent extends RenewalEventBase {
  readonly eventType: 'RenewalAccepted';
  readonly payload: {
    readonly previousOfftakeId: string;
    readonly newOfftakeId: string;
    readonly acceptedBy: UserId;
  };
}

export interface RenewalDeclinedEvent extends RenewalEventBase {
  readonly eventType: 'RenewalDeclined';
  readonly payload: {
    readonly offtakeId: string;
    readonly declinedBy: UserId;
    readonly reason: string | null;
  };
}

// NOTE (cross-package wire contract): the `LeaseTerminatedByRenewal`
// discriminator is NOT in the canonical rename map and is consumed by name
// by the api-gateway event-subscribers (off-limits). The string is left
// intact; only the surrounding domain symbols migrate to offtake.
export interface OfftakeTerminatedByRenewalEvent extends RenewalEventBase {
  readonly eventType: 'LeaseTerminatedByRenewal';
  readonly payload: {
    readonly offtakeId: string;
    readonly terminationDate: ISOTimestamp;
    readonly reason: string;
    readonly terminatedBy: UserId;
  };
}

/** @deprecated Use {@link OfftakeTerminatedByRenewalEvent}. */
export type LeaseTerminatedByRenewalEvent = OfftakeTerminatedByRenewalEvent;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ProposeRenewalInput {
  readonly proposedRoyalty: number;
  readonly proposedBy: UserId;
}

export interface AcceptRenewalInput {
  readonly newEndDate: ISOTimestamp;
  readonly acceptedBy: UserId;
}

export interface DeclineRenewalInput {
  readonly declinedBy: UserId;
  readonly reason?: string;
}

export interface TerminateInput {
  readonly terminationDate: ISOTimestamp;
  readonly reason: string;
  readonly terminatedBy: UserId;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Valid forward transitions. Reverse transitions are disallowed — once an
 * offtake is accepted/declined/terminated it is immutable.
 */
const ALLOWED_TRANSITIONS: Record<OfftakeRenewalStatus, OfftakeRenewalStatus[]> = {
  not_started: ['window_opened', 'terminated'],
  window_opened: ['proposed', 'declined', 'terminated', 'expired'],
  proposed: ['accepted', 'declined', 'terminated', 'expired'],
  accepted: [],
  declined: [],
  terminated: [],
  expired: [],
};

export class RenewalService {
  constructor(
    private readonly repo: RenewalRepository,
    private readonly eventBus: EventBus,
  ) {}

  async openRenewalWindow(
    offtakeId: string,
    tenantId: TenantId,
    openedBy: UserId,
    correlationId: string,
  ): Promise<Result<RenewalOfftakeSnapshot, RenewalServiceErrorResult>> {
    const offtake = await this.repo.findById(offtakeId, tenantId);
    if (!offtake) {
      return err('OFFTAKE_NOT_FOUND', 'Offtake not found');
    }
    if (!this.canTransition(offtake.renewalStatus, 'window_opened')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot open renewal window from ${offtake.renewalStatus}`,
      );
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: RenewalOfftakeSnapshot = {
      ...offtake,
      renewalStatus: 'window_opened',
      renewalWindowOpenedAt: now,
    };
    const saved = await this.repo.update(updated);

    const event: RenewalWindowOpenedEvent = {
      eventId: generateEventId(),
      eventType: 'RenewalWindowOpened',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        offtakeId: saved.id,
        offtakeNumber: saved.offtakeNumber,
        customerId: saved.customerId,
        endDate: saved.endDate,
        openedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Offtake'));
    return ok(saved);
  }

  async proposeRenewal(
    offtakeId: string,
    tenantId: TenantId,
    input: ProposeRenewalInput,
    correlationId: string,
  ): Promise<Result<RenewalOfftakeSnapshot, RenewalServiceErrorResult>> {
    if (input.proposedRoyalty <= 0) {
      return err('INVALID_INPUT', 'proposedRoyalty must be positive');
    }
    const offtake = await this.repo.findById(offtakeId, tenantId);
    if (!offtake) return err('OFFTAKE_NOT_FOUND', 'Offtake not found');
    if (!this.canTransition(offtake.renewalStatus, 'proposed')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot propose renewal from ${offtake.renewalStatus}`,
      );
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: RenewalOfftakeSnapshot = {
      ...offtake,
      renewalStatus: 'proposed',
      renewalProposedAt: now,
      renewalProposedRoyalty: input.proposedRoyalty,
    };
    const saved = await this.repo.update(updated);
    const event: RenewalProposedEvent = {
      eventId: generateEventId(),
      eventType: 'RenewalProposed',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        offtakeId: saved.id,
        proposedRoyalty: input.proposedRoyalty,
        proposedBy: input.proposedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Offtake'));
    return ok(saved);
  }

  async acceptRenewal(
    offtakeId: string,
    tenantId: TenantId,
    input: AcceptRenewalInput,
    correlationId: string,
  ): Promise<Result<RenewalOfftakeSnapshot, RenewalServiceErrorResult>> {
    const offtake = await this.repo.findById(offtakeId, tenantId);
    if (!offtake) return err('OFFTAKE_NOT_FOUND', 'Offtake not found');
    if (!this.canTransition(offtake.renewalStatus, 'accepted')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot accept renewal from ${offtake.renewalStatus}`,
      );
    }
    if (offtake.renewalProposedRoyalty == null) {
      return err(
        'INVALID_INPUT',
        'Cannot accept renewal without a proposal',
      );
    }

    const now = new Date().toISOString() as ISOTimestamp;
    // Stamp decision on the OLD offtake (immutable from here)
    const oldOfftakeUpdate: RenewalOfftakeSnapshot = {
      ...offtake,
      renewalStatus: 'accepted',
      renewalDecidedAt: now,
      renewalDecisionBy: input.acceptedBy,
    };
    await this.repo.update(oldOfftakeUpdate);

    const sequence = await this.repo.nextLeaseSequence(tenantId);
    const newOfftakeId = `offtake_${Date.now()}_${randomHex(4)}`;
    const newOfftakeNumber = `O-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`;

    const newOfftake = await this.repo.createRenewedLease({
      fromOfftakeId: offtake.id,
      tenantId,
      newOfftakeId,
      newOfftakeNumber,
      startDate: (offtake.endDate ?? now) as ISOTimestamp,
      endDate: input.newEndDate,
      royaltyAmount: offtake.renewalProposedRoyalty,
      royaltyCurrency: offtake.royaltyCurrency,
      createdBy: input.acceptedBy,
    });

    const event: RenewalAcceptedEvent = {
      eventId: generateEventId(),
      eventType: 'RenewalAccepted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        previousOfftakeId: offtake.id,
        newOfftakeId: newOfftake.id,
        acceptedBy: input.acceptedBy,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(event, newOfftake.id, 'Offtake'),
    );
    return ok(newOfftake);
  }

  async declineRenewal(
    offtakeId: string,
    tenantId: TenantId,
    input: DeclineRenewalInput,
    correlationId: string,
  ): Promise<Result<RenewalOfftakeSnapshot, RenewalServiceErrorResult>> {
    const offtake = await this.repo.findById(offtakeId, tenantId);
    if (!offtake) return err('OFFTAKE_NOT_FOUND', 'Offtake not found');
    if (!this.canTransition(offtake.renewalStatus, 'declined')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot decline renewal from ${offtake.renewalStatus}`,
      );
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: RenewalOfftakeSnapshot = {
      ...offtake,
      renewalStatus: 'declined',
      renewalDecidedAt: now,
      renewalDecisionBy: input.declinedBy,
      terminationReasonNotes: input.reason ?? offtake.terminationReasonNotes,
    };
    const saved = await this.repo.update(updated);
    const event: RenewalDeclinedEvent = {
      eventId: generateEventId(),
      eventType: 'RenewalDeclined',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        offtakeId: saved.id,
        declinedBy: input.declinedBy,
        reason: input.reason ?? null,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Offtake'));
    return ok(saved);
  }

  async terminate(
    offtakeId: string,
    tenantId: TenantId,
    input: TerminateInput,
    correlationId: string,
  ): Promise<Result<RenewalOfftakeSnapshot, RenewalServiceErrorResult>> {
    const offtake = await this.repo.findById(offtakeId, tenantId);
    if (!offtake) return err('OFFTAKE_NOT_FOUND', 'Offtake not found');
    if (!this.canTransition(offtake.renewalStatus, 'terminated')) {
      return err(
        'INVALID_TRANSITION',
        `Cannot terminate from ${offtake.renewalStatus}`,
      );
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: RenewalOfftakeSnapshot = {
      ...offtake,
      renewalStatus: 'terminated',
      renewalDecidedAt: now,
      renewalDecisionBy: input.terminatedBy,
      terminationDate: input.terminationDate,
      terminationReasonNotes: input.reason,
    };
    const saved = await this.repo.update(updated);
    const event: OfftakeTerminatedByRenewalEvent = {
      eventId: generateEventId(),
      eventType: 'LeaseTerminatedByRenewal',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        offtakeId: saved.id,
        terminationDate: input.terminationDate,
        reason: input.reason,
        terminatedBy: input.terminatedBy,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, saved.id, 'Offtake'));
    return ok(saved);
  }

  private canTransition(
    from: OfftakeRenewalStatus,
    to: OfftakeRenewalStatus,
  ): boolean {
    return ALLOWED_TRANSITIONS[from].includes(to);
  }
}
