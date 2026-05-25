/**
 * Negotiation domain types.
 *
 * Value-types only — no classes, no mutation. All domain records are
 * produced immutably: a turn is appended by creating a NEW record, never
 * by editing an existing one.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
} from '@borjie/domain-models';

export type NegotiationId = string & { readonly __brand: 'NegotiationId' };
export type NegotiationPolicyId = string & {
  readonly __brand: 'NegotiationPolicyId';
};
export type NegotiationTurnId = string & {
  readonly __brand: 'NegotiationTurnId';
};

export const asNegotiationId = (s: string): NegotiationId =>
  s as NegotiationId;
export const asNegotiationPolicyId = (s: string): NegotiationPolicyId =>
  s as NegotiationPolicyId;
export const asNegotiationTurnId = (s: string): NegotiationTurnId =>
  s as NegotiationTurnId;

export type NegotiationStatus =
  | 'open'
  | 'counter_sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'escalated';

export type NegotiationActor = 'prospect' | 'ai' | 'owner' | 'agent' | 'vendor';
export type NegotiationDomain = 'lease_price' | 'tender_bid';
export type NegotiationTone = 'firm' | 'warm' | 'flexible';

export interface NegotiationConcession {
  readonly kind:
    | 'free_month'
    | 'waived_deposit'
    | 'reduced_deposit'
    | 'payment_plan'
    | 'included_utilities'
    | 'flexible_move_in'
    | 'other';
  readonly description: string;
  readonly monetaryValue?: number; // minor units, estimated impact
  readonly maxCount?: number;
}

export interface NegotiationPolicy {
  readonly id: NegotiationPolicyId;
  readonly tenantId: TenantId;
  readonly unitId: string | null;
  readonly propertyId: string | null;
  readonly domain: NegotiationDomain;
  readonly listPrice: number; // minor units
  readonly floorPrice: number; // hard floor — AI MUST NOT cross
  readonly approvalRequiredBelow: number; // soft gate — escalate
  readonly maxDiscountPct: number; // e.g. 0.15
  readonly currency: string;
  readonly acceptableConcessions: ReadonlyArray<NegotiationConcession>;
  readonly toneGuide: NegotiationTone;
  readonly autoSendCounters: boolean;
  readonly expiresAt: ISOTimestamp | null;
  readonly active: boolean;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId | null;
  readonly updatedAt: ISOTimestamp;
  readonly updatedBy: UserId | null;
}

export interface Negotiation {
  readonly id: NegotiationId;
  readonly tenantId: TenantId;
  readonly unitId: string | null;
  readonly propertyId: string | null;
  readonly prospectCustomerId: string | null;
  readonly counterpartyId: string | null;
  readonly listingId: string | null;
  readonly tenderId: string | null;
  readonly bidId: string | null;
  readonly policyId: NegotiationPolicyId;
  readonly domain: NegotiationDomain;
  readonly status: NegotiationStatus;
  readonly aiPersona: string;
  readonly currentOffer: number | null;
  readonly currentOfferBy: NegotiationActor | null;
  readonly roundCount: number;
  readonly agreedPrice: number | null;
  readonly closedAt: ISOTimestamp | null;
  readonly closureReason: string | null;
  readonly escalatedAt: ISOTimestamp | null;
  readonly escalatedTo: string | null;
  readonly createdAt: ISOTimestamp;
  readonly lastActivityAt: ISOTimestamp;
  readonly expiresAt: ISOTimestamp | null;
}

export interface NegotiationTurn {
  readonly id: NegotiationTurnId;
  readonly tenantId: TenantId;
  readonly negotiationId: NegotiationId;
  readonly sequence: number;
  readonly actor: NegotiationActor;
  readonly actorUserId: UserId | null;
  readonly offer: number | null;
  readonly concessionsProposed: ReadonlyArray<NegotiationConcession>;
  readonly rationale: string | null;
  readonly aiModelTier: string | null;
  readonly policySnapshotId: NegotiationPolicyId | null;
  readonly policyCheckPassed: boolean;
  readonly policyCheckViolations: ReadonlyArray<string>;
  readonly advisorConsulted: boolean;
  readonly advisorDecision: string | null;
  readonly rawPayload: unknown;
  readonly createdAt: ISOTimestamp;
}

// ============================================================================
// Inputs
// ============================================================================

export interface StartNegotiationInput {
  readonly policyId: NegotiationPolicyId;
  readonly unitId?: string | null;
  readonly propertyId?: string | null;
  readonly prospectCustomerId?: string | null;
  readonly counterpartyId?: string | null;
  readonly listingId?: string | null;
  readonly tenderId?: string | null;
  readonly bidId?: string | null;
  readonly domain: NegotiationDomain;
  readonly aiPersona?: string;
  readonly openingOffer: number;
  readonly openingConcessions?: ReadonlyArray<NegotiationConcession>;
  readonly openingRationale?: string;
  readonly expiresAt?: ISOTimestamp | null;
}

export interface SubmitCounterInput {
  readonly negotiationId: NegotiationId;
  readonly actor: NegotiationActor;
  readonly actorUserId?: UserId | null;
  readonly offer: number;
  readonly concessions?: ReadonlyArray<NegotiationConcession>;
  readonly rationale?: string;
  readonly rawPayload?: unknown;
}

export interface CloseNegotiationInput {
  readonly negotiationId: NegotiationId;
  readonly actor: NegotiationActor;
  readonly actorUserId?: UserId | null;
  readonly agreedPrice?: number;
  readonly reason?: string;
}

// ============================================================================
// Repositories (interfaces — implementations wired in api-gateway)
// ============================================================================

export interface NegotiationPolicyRepository {
  findById(
    id: NegotiationPolicyId,
    tenantId: TenantId
  ): Promise<NegotiationPolicy | null>;
  create(policy: NegotiationPolicy): Promise<NegotiationPolicy>;
  update(
    id: NegotiationPolicyId,
    tenantId: TenantId,
    patch: Partial<NegotiationPolicy>
  ): Promise<NegotiationPolicy>;
}

export interface NegotiationRepository {
  findById(id: NegotiationId, tenantId: TenantId): Promise<Negotiation | null>;
  create(negotiation: Negotiation): Promise<Negotiation>;
  updateStatus(
    id: NegotiationId,
    tenantId: TenantId,
    patch: Partial<Negotiation>
  ): Promise<Negotiation>;
}

export interface NegotiationTurnRepository {
  /** Append a new turn. MUST be atomic with `NegotiationRepository.updateStatus`. */
  append(turn: NegotiationTurn): Promise<NegotiationTurn>;
  listByNegotiation(
    negotiationId: NegotiationId,
    tenantId: TenantId
  ): Promise<ReadonlyArray<NegotiationTurn>>;
  nextSequence(
    negotiationId: NegotiationId,
    tenantId: TenantId
  ): Promise<number>;
}

// ============================================================================
// Errors
// ============================================================================

export class NegotiationServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'POLICY_NOT_FOUND'
      | 'POLICY_INACTIVE'
      | 'POLICY_EXPIRED'
      | 'FLOOR_BREACH'
      | 'INVALID_STATUS'
      | 'NOT_FOUND'
      | 'VALIDATION'
      | 'ALREADY_CLOSED'
  ) {
    super(message);
    this.name = 'NegotiationServiceError';
  }
}
