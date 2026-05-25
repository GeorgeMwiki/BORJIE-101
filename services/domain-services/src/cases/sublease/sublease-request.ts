/**
 * Sublease Request entity types.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §7.
 */

import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type { LeaseId, CustomerId } from '../index.js';

export type SubleaseRequestId = string & { readonly __brand: 'SubleaseRequestId' };
export const asSubleaseRequestId = (s: string): SubleaseRequestId => s as SubleaseRequestId;

export type RentResponsibility = 'primary_tenant' | 'subtenant' | 'split';

export type SubleaseRequestStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface SubleaseRequest {
  readonly id: SubleaseRequestId;
  readonly tenantId: TenantId;
  readonly parentLeaseId: LeaseId;
  readonly requestedBy: CustomerId;
  readonly subtenantCandidateId?: CustomerId;
  readonly reason?: string;
  readonly startDate?: ISOTimestamp;
  readonly endDate?: ISOTimestamp;
  readonly rentResponsibility: RentResponsibility;
  readonly splitPercent?: Readonly<Record<string, number>>;
  readonly status: SubleaseRequestStatus;
  readonly approvalRequestId?: string;

  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface SubmitSubleaseInput {
  readonly parentLeaseId: LeaseId;
  readonly requestedBy: CustomerId;
  readonly subtenantCandidateId?: CustomerId;
  readonly reason?: string;
  readonly startDate?: ISOTimestamp;
  readonly endDate?: ISOTimestamp;
  readonly rentResponsibility?: RentResponsibility;
  readonly splitPercent?: Readonly<Record<string, number>>;
}

export interface ReviewSubleaseInput {
  readonly notes?: string;
}

export interface ApproveSubleaseInput {
  readonly approverNotes?: string;
  readonly effectiveFrom?: ISOTimestamp;
  readonly effectiveTo?: ISOTimestamp;
}

export interface RevokeSubleaseInput {
  readonly reason: string;
}
