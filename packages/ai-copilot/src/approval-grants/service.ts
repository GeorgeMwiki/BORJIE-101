/**
 * ApprovalGrantService — Wave 27 Agent D.
 *
 * The explicit human-authorization primitive. Every autonomous task-agent
 * run issues a `checkAuthorization(tenantId, actionCategory, request)` call
 * before execution, and if a matching active grant exists the executor
 * `consume`s it (single_action → used once; standing → increments counter).
 *
 * Design invariants:
 *   1. Grants are tenant-scoped by construction — the repository rejects
 *      cross-tenant lookups.
 *   2. Server-side `NOW()` enforces validity windows; callers cannot bypass
 *      via clock drift because the repository uses Postgres time.
 *   3. Revocation is immediate — `checkAuthorization` consults
 *      `revoked_at IS NULL` on every call.
 *   4. Standing auth `used_count` increments per consume; single_action flips
 *      0 → 1 and is then inert. The partial unique index in migration 0112
 *      prevents duplicate pending single-action grants for the same target.
 *   5. Consume is idempotent on `(grantId, actionRef)` — retrying with the
 *      same runId never double-counts.
 *   6. The service layer is repo-agnostic. Production wires Postgres; tests
 *      use the in-memory repo at the bottom of this file.
 */

import { randomUUID } from 'crypto';
import type {
  ApprovalGrant,
  ApprovalGrantDomain,
  ApprovalGrantEvent,
  ApprovalGrantEventPublisher,
  ApprovalGrantKind,
  ApprovalGrantRepository,
  ApprovalGrantScope,
  ApprovalGrantUsage,
  AuthorizationCheckResult,
  AuthorizationRequest,
  ConsumeResult,
  GrantSingleInput,
  GrantStandingInput,
  ListActiveFilters,
  ListHistoryFilters,
  SingleActionScope,
  StandingAuthorizationScope,
} from './types.js';
import { logger } from '../logger.js';

export interface ApprovalGrantServiceDeps {
  readonly repository: ApprovalGrantRepository;
  readonly eventPublisher?: ApprovalGrantEventPublisher | null;
  readonly clock?: () => Date;
}

export class ApprovalGrantService {
  constructor(private readonly deps: ApprovalGrantServiceDeps) {}

  // --------------------------------------------------------------------- //
  // GRANT ISSUANCE
  // --------------------------------------------------------------------- //

  async grantStanding(
    tenantId: string,
    input: GrantStandingInput,
  ): Promise<ApprovalGrant> {
    this.assertTenantId(tenantId);
    this.assertNonEmpty('actionCategory', input.actionCategory);
    this.assertNonEmpty('createdBy', input.createdBy);
    this.validateStandingScope(input.scope);

    if (input.maxUses != null && input.maxUses <= 0) {
      throw new Error('maxUses must be > 0');
    }
    if (input.validTo && input.validFrom && input.validTo <= input.validFrom) {
      throw new Error('validTo must be after validFrom');
    }

    const nowIso = this.now();
    const grant: ApprovalGrant = {
      id: `agrant_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      tenantId,
      kind: 'standing_authorization',
      domain: input.domain,
      actionCategory: input.actionCategory,
      scope: input.scope,
      validFrom: input.validFrom ?? nowIso,
      validTo: input.validTo ?? null,
      usedCount: 0,
      maxUses: input.maxUses ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      createdAt: nowIso,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    };

    const saved = await this.deps.repository.insert(grant);
    await this.publish({
      eventType: 'ApprovalGrantIssued',
      tenantId,
      grantId: saved.id,
      kind: saved.kind,
      domain: saved.domain,
      actionCategory: saved.actionCategory,
      createdBy: saved.createdBy,
      occurredAt: nowIso,
    });
    return saved;
  }

  async grantSingle(
    tenantId: string,
    input: GrantSingleInput,
  ): Promise<ApprovalGrant> {
    this.assertTenantId(tenantId);
    this.assertNonEmpty('actionCategory', input.actionCategory);
    this.assertNonEmpty('createdBy', input.createdBy);
    this.validateSingleScope(input.scope);

    const nowIso = this.now();
    const grant: ApprovalGrant = {
      id: `agrant_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      tenantId,
      kind: 'single_action',
      domain: input.domain,
      actionCategory: input.actionCategory,
      scope: input.scope,
      validFrom: input.validFrom ?? nowIso,
      validTo: input.validTo ?? null,
      usedCount: 0,
      maxUses: 1,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      createdAt: nowIso,
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
    };

    const saved = await this.deps.repository.insert(grant);
    await this.publish({
      eventType: 'ApprovalGrantIssued',
      tenantId,
      grantId: saved.id,
      kind: saved.kind,
      domain: saved.domain,
      actionCategory: saved.actionCategory,
      createdBy: saved.createdBy,
      occurredAt: nowIso,
    });
    return saved;
  }

  // --------------------------------------------------------------------- //
  // AUTHORIZATION CHECK (hot path)
  // --------------------------------------------------------------------- //

  /**
   * Returns the first matching active grant for (tenantId, actionCategory)
   * that passes scope checks against the request. Preference order:
   *   1. A single_action grant that exactly matches the target (once
   *      consumed, single grants disappear from this query).
   *   2. A standing_authorization grant whose scope covers the request.
   *
   * If no matching grant is found, the caller must create an approval
   * request (mustRequestApproval=true) which, when approved, auto-issues
   * a single_action grant.
   */
  async checkAuthorization(
    tenantId: string,
    actionCategory: string,
    request: AuthorizationRequest,
  ): Promise<AuthorizationCheckResult> {
    this.assertTenantId(tenantId);
    this.assertNonEmpty('actionCategory', actionCategory);
    const nowIso = this.now();

    const active = await this.deps.repository.findActiveForCategory(
      tenantId,
      actionCategory,
      nowIso,
    );

    // Prefer single-action (exact match) over standing (broader).
    const single = active.find(
      (g) => g.kind === 'single_action' && matchesSingleScope(g, request),
    );
    if (single) {
      return {
        authorized: true,
        grantId: single.id,
        kind: 'single',
        reason: 'Matched single-action grant',
        mustRequestApproval: false,
      };
    }

    const standing = active.find(
      (g) =>
        g.kind === 'standing_authorization' &&
        matchesStandingScope(g, request),
    );
    if (standing) {
      // Enforce max_uses server-check (layered on DB).
      if (standing.maxUses != null && standing.usedCount >= standing.maxUses) {
        return {
          authorized: false,
          grantId: null,
          kind: 'none',
          reason: 'Standing grant exhausted (max_uses reached)',
          mustRequestApproval: true,
        };
      }
      return {
        authorized: true,
        grantId: standing.id,
        kind: 'standing',
        reason: 'Matched standing authorization',
        mustRequestApproval: false,
      };
    }

    // No match. Tell the caller to create an approval request.
    return {
      authorized: false,
      grantId: null,
      kind: 'none',
      reason: 'No active grant covers this action',
      mustRequestApproval: true,
    };
  }

  // --------------------------------------------------------------------- //
  // CONSUME
  // --------------------------------------------------------------------- //

  async consume(
    grantId: string,
    tenantId: string,
    actionRef: string,
    options: { actor?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<ConsumeResult> {
    this.assertTenantId(tenantId);
    this.assertNonEmpty('grantId', grantId);
    this.assertNonEmpty('actionRef', actionRef);

    const grant = await this.deps.repository.findById(tenantId, grantId);
    if (!grant) {
      throw new Error(`Grant not found: ${grantId}`);
    }
    if (grant.tenantId !== tenantId) {
      // Defensive — repo should never leak but verify here too.
      throw new Error('Cross-tenant grant access denied');
    }
    if (grant.revokedAt) {
      throw new Error('Grant is revoked');
    }

    const nowIso = this.now();
    if (grant.validTo && grant.validTo < nowIso) {
      throw new Error('Grant is expired');
    }
    if (grant.validFrom > nowIso) {
      throw new Error('Grant not yet valid');
    }
    if (grant.maxUses != null && grant.usedCount >= grant.maxUses) {
      throw new Error('Grant exhausted');
    }

    const usageRecord: ApprovalGrantUsage = {
      id: `agu_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      grantId,
      tenantId,
      actionRef,
      consumedAt: nowIso,
      actor: options.actor ?? null,
      metadata: options.metadata ?? {},
    };

    const result = await this.deps.repository.incrementUsage(
      grantId,
      tenantId,
      usageRecord,
    );

    await this.publish({
      eventType: 'ApprovalGrantConsumed',
      tenantId,
      grantId,
      kind: grant.kind,
      actionCategory: grant.actionCategory,
      actionRef,
      actor: options.actor ?? null,
      usedCount: result.usedCount,
      occurredAt: nowIso,
    });

    return {
      consumed: !result.idempotent,
      grantId,
      usageId: result.usageId,
      idempotent: result.idempotent,
      usedCount: result.usedCount,
    };
  }

  // --------------------------------------------------------------------- //
  // REVOCATION (immediate)
  // --------------------------------------------------------------------- //

  async revoke(
    grantId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
  ): Promise<ApprovalGrant> {
    this.assertTenantId(tenantId);
    this.assertNonEmpty('grantId', grantId);
    this.assertNonEmpty('revokedBy', revokedBy);
    this.assertNonEmpty('reason', reason);

    const nowIso = this.now();
    const revoked = await this.deps.repository.revoke(
      grantId,
      tenantId,
      revokedBy,
      reason,
      nowIso,
    );
    if (!revoked) {
      throw new Error(`Grant not found or already revoked: ${grantId}`);
    }
    await this.publish({
      eventType: 'ApprovalGrantRevoked',
      tenantId,
      grantId,
      revokedBy,
      reason,
      occurredAt: nowIso,
    });
    return revoked;
  }

  // --------------------------------------------------------------------- //
  // LIST
  // --------------------------------------------------------------------- //

  async listActive(
    tenantId: string,
    filters: ListActiveFilters = {},
  ): Promise<readonly ApprovalGrant[]> {
    this.assertTenantId(tenantId);
    return this.deps.repository.listActive(tenantId, filters, this.now());
  }

  async listHistory(
    tenantId: string,
    filters: ListHistoryFilters = {},
  ): Promise<readonly ApprovalGrant[]> {
    this.assertTenantId(tenantId);
    return this.deps.repository.listHistory(tenantId, filters);
  }

  // --------------------------------------------------------------------- //
  // Helpers
  // --------------------------------------------------------------------- //

  private now(): string {
    return (this.deps.clock?.() ?? new Date()).toISOString();
  }

  private async publish(event: ApprovalGrantEvent): Promise<void> {
    if (!this.deps.eventPublisher) return;
    try {
      await this.deps.eventPublisher.publish(event);
    } catch (err) {
      // Event publish must never break grant operations.
       
      logger.error('ApprovalGrantService: event publish failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private assertTenantId(tenantId: string): void {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('tenantId is required');
    }
  }

  private assertNonEmpty(name: string, value: string): void {
    if (!value || typeof value !== 'string') {
      throw new Error(`${name} is required`);
    }
  }

  private validateStandingScope(scope: StandingAuthorizationScope): void {
    if (scope.entityIds !== undefined && scope.entityIds !== null) {
      if (!Array.isArray(scope.entityIds) || scope.entityIds.length === 0) {
        throw new Error('scope.entityIds must be null or a non-empty array');
      }
    }
    if (
      scope.amountCeilingMinorUnits != null &&
      scope.amountCeilingMinorUnits < 0
    ) {
      throw new Error('scope.amountCeilingMinorUnits must be >= 0');
    }
    if (scope.maxPerDay != null && scope.maxPerDay <= 0) {
      throw new Error('scope.maxPerDay must be > 0');
    }
  }

  private validateSingleScope(scope: SingleActionScope): void {
    this.assertNonEmpty('scope.targetEntityType', scope.targetEntityType);
    this.assertNonEmpty('scope.targetEntityId', scope.targetEntityId);
    if (
      scope.amountMinorUnits != null &&
      scope.amountMinorUnits < 0
    ) {
      throw new Error('scope.amountMinorUnits must be >= 0');
    }
  }
}

// --------------------------------------------------------------------------- //
// Scope matching helpers (pure)
// --------------------------------------------------------------------------- //

function matchesSingleScope(
  grant: ApprovalGrant,
  req: AuthorizationRequest,
): boolean {
  const scope = grant.scope as SingleActionScope;
  if (!scope.targetEntityType || !scope.targetEntityId) return false;
  if (
    req.targetEntityType !== scope.targetEntityType ||
    req.targetEntityId !== scope.targetEntityId
  ) {
    return false;
  }
  if (
    scope.amountMinorUnits != null &&
    req.amountMinorUnits != null &&
    req.amountMinorUnits > scope.amountMinorUnits
  ) {
    return false;
  }
  return true;
}

function matchesStandingScope(
  grant: ApprovalGrant,
  req: AuthorizationRequest,
): boolean {
  const scope = grant.scope as StandingAuthorizationScope;
  // Amount ceiling
  if (
    scope.amountCeilingMinorUnits != null &&
    req.amountMinorUnits != null &&
    req.amountMinorUnits > scope.amountCeilingMinorUnits
  ) {
    return false;
  }
  // Entity-type gate (if grant specifies one, request must match)
  if (
    scope.entityType &&
    req.targetEntityType &&
    scope.entityType !== req.targetEntityType
  ) {
    return false;
  }
  // Entity allow-list
  if (scope.entityIds && scope.entityIds.length > 0) {
    if (
      !req.targetEntityId ||
      !scope.entityIds.includes(req.targetEntityId)
    ) {
      return false;
    }
  }
  return true;
}

// --------------------------------------------------------------------------- //
// In-memory repository (tests + degraded gateway). Never shared between tenants.
// --------------------------------------------------------------------------- //

interface MemoryUsageKey {
  readonly grantId: string;
  readonly actionRef: string;
}

export class InMemoryApprovalGrantRepository
  implements ApprovalGrantRepository
{
  private readonly grants = new Map<string, ApprovalGrant>();
  private readonly usages = new Map<string, ApprovalGrantUsage>();

  async insert(grant: ApprovalGrant): Promise<ApprovalGrant> {
    if (this.grants.has(grant.id)) {
      throw new Error(`Grant id collision: ${grant.id}`);
    }
    // Emulate the unique partial index for pending single-action grants.
    if (grant.kind === 'single_action') {
      const scope = grant.scope as SingleActionScope;
      for (const existing of this.grants.values()) {
        if (
          existing.tenantId === grant.tenantId &&
          existing.kind === 'single_action' &&
          existing.actionCategory === grant.actionCategory &&
          existing.usedCount === 0 &&
          !existing.revokedAt
        ) {
          const existingScope = existing.scope as SingleActionScope;
          if (
            existingScope.targetEntityType === scope.targetEntityType &&
            existingScope.targetEntityId === scope.targetEntityId
          ) {
            throw new Error(
              'A pending single-action grant already exists for this target',
            );
          }
        }
      }
    }
    this.grants.set(grant.id, grant);
    return grant;
  }

  async findById(
    tenantId: string,
    grantId: string,
  ): Promise<ApprovalGrant | null> {
    const g = this.grants.get(grantId);
    if (!g || g.tenantId !== tenantId) return null;
    return g;
  }

  async findActiveForCategory(
    tenantId: string,
    actionCategory: string,
    nowIso: string,
  ): Promise<readonly ApprovalGrant[]> {
    return [...this.grants.values()]
      .filter(
        (g) =>
          g.tenantId === tenantId &&
          g.actionCategory === actionCategory &&
          !g.revokedAt &&
          g.validFrom <= nowIso &&
          (!g.validTo || g.validTo > nowIso) &&
          (g.maxUses == null || g.usedCount < g.maxUses),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }

  async listActive(
    tenantId: string,
    filters: ListActiveFilters,
    nowIso: string,
  ): Promise<readonly ApprovalGrant[]> {
    const results = [...this.grants.values()].filter(
      (g) =>
        g.tenantId === tenantId &&
        !g.revokedAt &&
        g.validFrom <= nowIso &&
        (!g.validTo || g.validTo > nowIso) &&
        (g.maxUses == null || g.usedCount < g.maxUses) &&
        (!filters.domain || g.domain === filters.domain) &&
        (!filters.kind || g.kind === filters.kind) &&
        (!filters.actionCategory ||
          g.actionCategory === filters.actionCategory),
    );
    results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return filters.limit ? results.slice(0, filters.limit) : results;
  }

  async listHistory(
    tenantId: string,
    filters: ListHistoryFilters,
  ): Promise<readonly ApprovalGrant[]> {
    const includeRevoked = filters.includeRevoked ?? true;
    const results = [...this.grants.values()].filter(
      (g) =>
        g.tenantId === tenantId &&
        (includeRevoked || !g.revokedAt) &&
        (!filters.domain || g.domain === filters.domain) &&
        (!filters.kind || g.kind === filters.kind) &&
        (!filters.actionCategory ||
          g.actionCategory === filters.actionCategory),
    );
    results.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }

  async incrementUsage(
    grantId: string,
    tenantId: string,
    usage: ApprovalGrantUsage,
  ): Promise<{ usedCount: number; idempotent: boolean; usageId: string }> {
    const grant = this.grants.get(grantId);
    if (!grant || grant.tenantId !== tenantId) {
      throw new Error(`Grant not found: ${grantId}`);
    }
    // Idempotency on (grantId, actionRef)
    for (const existing of this.usages.values()) {
      if (existing.grantId === grantId && existing.actionRef === usage.actionRef) {
        return {
          usedCount: grant.usedCount,
          idempotent: true,
          usageId: existing.id,
        };
      }
    }
    const nextCount = grant.usedCount + 1;
    const updated: ApprovalGrant = { ...grant, usedCount: nextCount };
    this.grants.set(grantId, updated);
    this.usages.set(usage.id, usage);
    return { usedCount: nextCount, idempotent: false, usageId: usage.id };
  }

  async revoke(
    grantId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
    nowIso: string,
  ): Promise<ApprovalGrant | null> {
    const grant = this.grants.get(grantId);
    if (!grant || grant.tenantId !== tenantId) return null;
    if (grant.revokedAt) return null;
    const updated: ApprovalGrant = {
      ...grant,
      revokedAt: nowIso,
      revokedBy,
      revokeReason: reason,
    };
    this.grants.set(grantId, updated);
    return updated;
  }

  // Test helper
  clear(): void {
    this.grants.clear();
    this.usages.clear();
  }
}

// Re-export scope matchers for unit testing
export const __scopeMatchers = { matchesSingleScope, matchesStandingScope };
