/**
 * User-scope binding repository port (Wave 18X §3).
 *
 * Mirrors the override-repository pattern. The Drizzle implementation
 * lives in `@borjie/database`; this package only exposes the interface
 * + an in-memory implementation for tests + fixture-driven previews.
 */

import type { OrgRole, ScopeKind, UserScopeBinding } from '../types.js';

export interface ListBindingsQuery {
  readonly tenantId: string;
  readonly userId?: string;
  readonly orgUnitId?: string | null;
  readonly includeRevoked?: boolean;
}

export interface GrantBindingInput {
  readonly userId: string;
  readonly tenantId: string;
  readonly scopeKind: ScopeKind;
  readonly orgUnitId: string | null;
  readonly role: OrgRole;
  readonly authorityTierMax: 0 | 1 | 2;
  readonly grantedBy: string;
}

export interface UserScopeBindingRepository {
  list(query: ListBindingsQuery): Promise<ReadonlyArray<UserScopeBinding>>;
  grant(input: GrantBindingInput): Promise<UserScopeBinding>;
  revoke(id: string, revokedAt?: string): Promise<void>;
}

export class InMemoryUserScopeBindingRepository
  implements UserScopeBindingRepository
{
  private readonly rows = new Map<string, UserScopeBinding>();

  public async list(query: ListBindingsQuery): Promise<ReadonlyArray<UserScopeBinding>> {
    const includeRevoked = query.includeRevoked === true;
    const out: UserScopeBinding[] = [];
    for (const row of this.rows.values()) {
      if (row.tenant_id !== query.tenantId) continue;
      if (query.userId !== undefined && row.user_id !== query.userId) continue;
      if (query.orgUnitId !== undefined && row.org_unit_id !== query.orgUnitId) continue;
      if (!includeRevoked && row.revoked_at !== null) continue;
      out.push(row);
    }
    return out;
  }

  public async grant(input: GrantBindingInput): Promise<UserScopeBinding> {
    const id = `${input.tenantId}:${input.userId}:${input.orgUnitId ?? 'root'}:${input.role}`;
    const next: UserScopeBinding = {
      id,
      user_id: input.userId,
      tenant_id: input.tenantId,
      scope_kind: input.scopeKind,
      org_unit_id: input.orgUnitId,
      role: input.role,
      authority_tier_max: input.authorityTierMax,
      granted_at: new Date().toISOString(),
      granted_by: input.grantedBy,
      revoked_at: null,
    };
    this.rows.set(id, next);
    return next;
  }

  public async revoke(id: string, revokedAt?: string): Promise<void> {
    const row = this.rows.get(id);
    if (row === undefined) return;
    this.rows.set(id, {
      ...row,
      revoked_at: revokedAt ?? new Date().toISOString(),
    });
  }
}
