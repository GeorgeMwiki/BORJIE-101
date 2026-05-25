/**
 * Approval Grant types — Wave 27 Agent D.
 *
 * Materializes the user's "human approves everything, then we clarify if
 * it's a one-shot or a repeatable authorization" model into a first-class
 * primitive. Every autonomous action (task-agent, orchestrator tick,
 * background worker) consults `ApprovalGrantService.checkAuthorization`
 * BEFORE executing — layered ON TOP of the existing AutonomyPolicyService
 * (both gates must say yes).
 */

/** Domains cover the autonomy domains PLUS categories introduced here. */
export type ApprovalGrantDomain =
  | 'finance'
  | 'leasing'
  | 'maintenance'
  | 'compliance'
  | 'communications'
  | 'marketing'
  | 'hr'
  | 'procurement'
  | 'insurance'
  | 'legal_proceedings'
  | 'tenant_welfare';

export const APPROVAL_GRANT_DOMAINS: readonly ApprovalGrantDomain[] = [
  'finance',
  'leasing',
  'maintenance',
  'compliance',
  'communications',
  'marketing',
  'hr',
  'procurement',
  'insurance',
  'legal_proceedings',
  'tenant_welfare',
] as const;

export type ApprovalGrantKind = 'single_action' | 'standing_authorization';

export const APPROVAL_GRANT_KINDS: readonly ApprovalGrantKind[] = [
  'single_action',
  'standing_authorization',
] as const;

/** Shape of the jsonb `scope_json` column. Variant per kind. */
export interface SingleActionScope {
  readonly targetEntityType: string;
  readonly targetEntityId: string;
  readonly amountMinorUnits?: number;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface StandingAuthorizationScope {
  /** Max per-action amount this grant authorizes. */
  readonly amountCeilingMinorUnits?: number;
  /** Entity type this grant applies to (e.g. 'lease', 'unit'). */
  readonly entityType?: string;
  /**
   * Optional allow-list of entity ids. null / undefined = ANY entity of the
   * given type. Explicit empty array = none (practically useless, but
   * unambiguous — we reject empty arrays in the service layer).
   */
  readonly entityIds?: readonly string[] | null;
  /** Soft daily cap layered on top of max_uses. */
  readonly maxPerDay?: number;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export type ApprovalGrantScope = SingleActionScope | StandingAuthorizationScope;

// ---------------------------------------------------------------------------
// Grant record (persisted shape returned to callers)
// ---------------------------------------------------------------------------

export interface ApprovalGrant {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: ApprovalGrantKind;
  readonly domain: ApprovalGrantDomain;
  readonly actionCategory: string;
  readonly scope: ApprovalGrantScope;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly usedCount: number;
  readonly maxUses: number | null;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly revokeReason: string | null;
}

export interface ApprovalGrantUsage {
  readonly id: string;
  readonly grantId: string;
  readonly tenantId: string;
  readonly actionRef: string;
  readonly consumedAt: string;
  readonly actor: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface GrantStandingInput {
  readonly domain: ApprovalGrantDomain;
  readonly actionCategory: string;
  readonly scope: StandingAuthorizationScope;
  readonly validFrom?: string;
  readonly validTo?: string | null;
  readonly maxUses?: number | null;
  readonly notes?: string | null;
  readonly createdBy: string;
}

export interface GrantSingleInput {
  readonly domain: ApprovalGrantDomain;
  readonly actionCategory: string;
  readonly scope: SingleActionScope;
  readonly validFrom?: string;
  readonly validTo?: string | null;
  readonly notes?: string | null;
  readonly createdBy: string;
}

/**
 * Request shape passed to `checkAuthorization`. The service matches the
 * request against any active grant's scope.
 */
export interface AuthorizationRequest {
  readonly domain: ApprovalGrantDomain;
  readonly targetEntityType?: string;
  readonly targetEntityId?: string;
  readonly amountMinorUnits?: number;
  readonly actor?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface AuthorizationCheckResult {
  readonly authorized: boolean;
  readonly grantId: string | null;
  readonly kind: 'standing' | 'single' | 'none';
  readonly reason: string;
  /**
   * When `authorized=false`, this tells the caller whether to create an
   * approval request (true) or hard-block (false). The executor uses this
   * to decide between `skipped_pending_approval` vs `skipped_no_grant`.
   */
  readonly mustRequestApproval: boolean;
}

export interface ConsumeResult {
  readonly consumed: boolean;
  readonly grantId: string;
  readonly usageId: string;
  readonly idempotent: boolean;
  readonly usedCount: number;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ListActiveFilters {
  readonly domain?: ApprovalGrantDomain;
  readonly kind?: ApprovalGrantKind;
  readonly actionCategory?: string;
  readonly limit?: number;
}

export interface ListHistoryFilters {
  readonly domain?: ApprovalGrantDomain;
  readonly kind?: ApprovalGrantKind;
  readonly actionCategory?: string;
  readonly includeRevoked?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface ApprovalGrantRepository {
  insert(grant: ApprovalGrant): Promise<ApprovalGrant>;
  findById(tenantId: string, grantId: string): Promise<ApprovalGrant | null>;
  /**
   * Return all active (not revoked, within time window, not exhausted)
   * grants for a tenant+actionCategory. Server-side NOW() is used so
   * clock drift cannot bypass expiry.
   */
  findActiveForCategory(
    tenantId: string,
    actionCategory: string,
    nowIso: string,
  ): Promise<readonly ApprovalGrant[]>;
  listActive(
    tenantId: string,
    filters: ListActiveFilters,
    nowIso: string,
  ): Promise<readonly ApprovalGrant[]>;
  listHistory(
    tenantId: string,
    filters: ListHistoryFilters,
  ): Promise<readonly ApprovalGrant[]>;
  incrementUsage(
    grantId: string,
    tenantId: string,
    usage: ApprovalGrantUsage,
  ): Promise<{ usedCount: number; idempotent: boolean; usageId: string }>;
  revoke(
    grantId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
    nowIso: string,
  ): Promise<ApprovalGrant | null>;
}

// ---------------------------------------------------------------------------
// Domain events (emitted on grant lifecycle for audit-trail-v2 subscriber)
// ---------------------------------------------------------------------------

export type ApprovalGrantEvent =
  | {
      readonly eventType: 'ApprovalGrantIssued';
      readonly tenantId: string;
      readonly grantId: string;
      readonly kind: ApprovalGrantKind;
      readonly domain: ApprovalGrantDomain;
      readonly actionCategory: string;
      readonly createdBy: string;
      readonly occurredAt: string;
    }
  | {
      readonly eventType: 'ApprovalGrantConsumed';
      readonly tenantId: string;
      readonly grantId: string;
      readonly kind: ApprovalGrantKind;
      readonly actionCategory: string;
      readonly actionRef: string;
      readonly actor: string | null;
      readonly usedCount: number;
      readonly occurredAt: string;
    }
  | {
      readonly eventType: 'ApprovalGrantRevoked';
      readonly tenantId: string;
      readonly grantId: string;
      readonly revokedBy: string;
      readonly reason: string;
      readonly occurredAt: string;
    };

export interface ApprovalGrantEventPublisher {
  publish(event: ApprovalGrantEvent): Promise<void> | void;
}
