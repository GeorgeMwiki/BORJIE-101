/**
 * Junior-AI factory — Wave 28 self-service provisioning.
 *
 * A team lead spins up narrow, domain-scoped junior AIs (e.g. "my arrears
 * lieutenant for ward 3"). Each junior inherits a subset of the tenant's
 * AutonomyPolicy so its authority can never exceed what the head has
 * already delegated to Mr. Mwikila; tooling is restricted via an explicit
 * allow-list; memory can be shared with the team or kept personal to the
 * lead; lifecycle caps (expiry, max-actions-per-day) keep runaway agents
 * bounded.
 *
 * The factory is transport-free: callers talk to JuniorAIFactoryService
 * (below, in service.ts). Persistence is pluggable via
 * JuniorAIRepository — the in-memory implementation ships here for tests
 * and the Postgres binding is wired at api-gateway composition root.
 */

import type { AutonomyDomain, AutonomyPolicy } from '../autonomy/types.js';

export type MemoryScope = 'team' | 'personal';

export type JuniorAIStatus = 'provisioning' | 'active' | 'suspended' | 'revoked';

/** Lifecycle constraints the team lead may set on a junior. */
export interface JuniorAILifecycle {
  readonly expiresAt?: string;
  readonly maxActionsPerDay?: number;
}

/**
 * JuniorAISpec — everything a team lead needs to describe a junior.
 *
 * `policySubset` must be a subset of the tenant AutonomyPolicy (enforced
 * by `validatePolicySubset` at provision time). The lead cannot grant the
 * junior powers the head has not already delegated.
 */
export interface JuniorAISpec {
  readonly tenantId: string;
  readonly teamLeadUserId: string;
  readonly domain: AutonomyDomain;
  readonly mandate: string;
  readonly policySubset: Partial<AutonomyPolicy>;
  readonly toolAllowlist: readonly string[];
  readonly memoryScope: MemoryScope;
  readonly certificationRequired: boolean;
  readonly lifecycle: JuniorAILifecycle;
}

/** Persisted record — JuniorAISpec + id + audit fields. */
export interface JuniorAIRecord extends JuniorAISpec {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: JuniorAIStatus;
  readonly suspendedReason: string | null;
  readonly revokedAt: string | null;
  /** Total actions the junior has taken in the current UTC day. */
  readonly actionsToday: number;
  /** UTC day the `actionsToday` counter was last reset. */
  readonly actionsTodayDate: string | null;
}

/** Patch passed to adjustScope — narrow set of mutable fields. */
export interface JuniorAIScopePatch {
  readonly policySubset?: Partial<AutonomyPolicy>;
  readonly toolAllowlist?: readonly string[];
  readonly mandate?: string;
  readonly lifecycle?: JuniorAILifecycle;
}

export interface ListJuniorAIFilters {
  readonly teamLeadUserId?: string;
  readonly domain?: AutonomyDomain;
  readonly status?: JuniorAIStatus;
}

/** Repository contract (in-memory + Postgres implementations). */
export interface JuniorAIRepository {
  insert(record: JuniorAIRecord): Promise<JuniorAIRecord>;
  findById(tenantId: string, id: string): Promise<JuniorAIRecord | null>;
  list(tenantId: string, filters: ListJuniorAIFilters): Promise<readonly JuniorAIRecord[]>;
  update(tenantId: string, id: string, patch: Partial<JuniorAIRecord>): Promise<JuniorAIRecord>;
}

/**
 * Audit event emitted on every lifecycle transition.
 * The factory exposes an `onAudit` hook so the api-gateway can forward
 * the event to the platform event bus / audit chain.
 */
export type JuniorAIAuditKind =
  | 'provisioned'
  | 'scope_adjusted'
  | 'suspended'
  | 'revoked'
  | 'action_capped';

export interface JuniorAIAuditEvent {
  readonly kind: JuniorAIAuditKind;
  readonly juniorAIId: string;
  readonly tenantId: string;
  readonly teamLeadUserId: string;
  readonly occurredAt: string;
  readonly summary: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Thrown when a provision/adjust request exceeds the tenant AutonomyPolicy. */
export class PolicySubsetViolationError extends Error {
  public readonly code = 'POLICY_SUBSET_VIOLATION';
  public readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`Junior-AI policy exceeds tenant autonomy: ${violations.join('; ')}`);
    this.name = 'PolicySubsetViolationError';
    this.violations = violations;
  }
}

/** Thrown when the daily action cap has been exhausted. */
export class DailyActionCapExceededError extends Error {
  public readonly code = 'DAILY_ACTION_CAP_EXCEEDED';
  constructor(juniorAIId: string, cap: number) {
    super(`Junior-AI ${juniorAIId} exhausted its ${cap}-per-day cap.`);
    this.name = 'DailyActionCapExceededError';
  }
}

/** Thrown when a junior is found in a non-active state (suspended/revoked). */
export class JuniorAINotActiveError extends Error {
  public readonly code = 'JUNIOR_AI_NOT_ACTIVE';
  constructor(juniorAIId: string, status: JuniorAIStatus) {
    super(`Junior-AI ${juniorAIId} is ${status}.`);
    this.name = 'JuniorAINotActiveError';
  }
}
