/**
 * Tenant Group entity types.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §7.
 */

import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type { LeaseId, CustomerId } from '../index.js';

export type TenantGroupId = string & { readonly __brand: 'TenantGroupId' };
export const asTenantGroupId = (s: string): TenantGroupId => s as TenantGroupId;

export type TenantGroupRole = 'primary' | 'subtenant' | 'co_tenant';

export interface TenantGroupMember {
  readonly customerId: CustomerId;
  readonly role: TenantGroupRole;
  readonly addedAt: ISOTimestamp;
  readonly archivedAt?: ISOTimestamp;
}

export interface TenantGroup {
  readonly id: TenantGroupId;
  readonly tenantId: TenantId;
  readonly primaryLeaseId: LeaseId;
  readonly members: readonly TenantGroupMember[];
  readonly effectiveFrom?: ISOTimestamp;
  readonly effectiveTo?: ISOTimestamp;

  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}
