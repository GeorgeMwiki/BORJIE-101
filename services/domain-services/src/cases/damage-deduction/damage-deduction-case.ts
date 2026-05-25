/**
 * Damage-Deduction Case entity types.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §8.
 */

import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type { CaseId, LeaseId } from '../index.js';

export type DamageDeductionCaseId = string & { readonly __brand: 'DamageDeductionCaseId' };
export type MoveOutInspectionId = string & { readonly __brand: 'MoveOutInspectionId' };
export type EvidenceBundleId = string & { readonly __brand: 'EvidenceBundleId' };

export const asDamageDeductionCaseId = (s: string): DamageDeductionCaseId =>
  s as DamageDeductionCaseId;

export type DamageDeductionStatus =
  | 'claim_filed'
  | 'tenant_responded'
  | 'negotiating'
  | 'agreed'
  | 'escalated'
  | 'resolved';

export type NegotiationTurnActor = 'owner' | 'tenant' | 'ai_mediator';

export interface NegotiationTurn {
  readonly id: string;
  readonly actor: NegotiationTurnActor;
  readonly actorId?: UserId;
  readonly proposedAmountMinor?: number;
  readonly rationale: string;
  readonly createdAt: ISOTimestamp;
}

export interface DamageDeductionCase {
  readonly id: DamageDeductionCaseId;
  readonly tenantId: TenantId;
  readonly leaseId?: LeaseId;
  readonly caseId?: CaseId;
  readonly moveOutInspectionId?: MoveOutInspectionId;

  readonly claimedDeductionMinor: number;
  readonly proposedDeductionMinor?: number;
  readonly tenantCounterProposalMinor?: number;
  readonly currency: string;

  readonly status: DamageDeductionStatus;

  readonly evidenceBundleId?: EvidenceBundleId;
  readonly aiMediatorTurns: readonly NegotiationTurn[];

  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface FileClaimInput {
  readonly leaseId?: LeaseId;
  readonly caseId?: CaseId;
  readonly moveOutInspectionId?: MoveOutInspectionId;
  readonly claimedDeductionMinor: number;
  readonly currency?: string;
  readonly rationale: string;
}

export interface TenantRespondInput {
  readonly counterProposalMinor?: number;
  readonly rationale: string;
}

export interface AgreeAndSettleInput {
  readonly agreedAmountMinor: number;
  readonly notes?: string;
}
