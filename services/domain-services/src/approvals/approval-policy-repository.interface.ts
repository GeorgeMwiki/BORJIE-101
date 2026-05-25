/**
 * Approval Policy Repository Interface (per-org overrides)
 *
 * This interface is additive to the existing ApprovalPolicyRepository in
 * approval-repository.interface.ts. It expresses the narrower API needed by
 * the per-org configurability feature (scaffolded item #12):
 *
 *   - findPolicy:   read a single override (null means "use the default")
 *   - upsertPolicy: insert-or-update an override (tenant + type = PK)
 *   - listPolicies: enumerate all overrides for a tenant
 *
 * Defaults live in default-policies.ts and remain the fallback floor. The
 * service tries this repo first and falls back to getDefaultPolicyForType
 * when no override is present.
 */

import type { TenantId, UserId } from '@borjie/domain-models';
import type { ApprovalPolicy, ApprovalType } from './types.js';

export interface ApprovalPolicyOverrideRepository {
  /** Returns the stored override for (tenantId, type), or null when none exists. */
  findPolicy(
    tenantId: TenantId,
    type: ApprovalType
  ): Promise<ApprovalPolicy | null>;

  /** Upserts a policy override for (tenantId, type). */
  upsertPolicy(
    tenantId: TenantId,
    type: ApprovalType,
    policy: ApprovalPolicy,
    actor: UserId
  ): Promise<void>;

  /** Lists all overrides for a given tenant. Does NOT include defaults. */
  listPolicies(tenantId: TenantId): Promise<readonly ApprovalPolicy[]>;
}
