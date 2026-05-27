/**
 * Scope switcher — produces the SessionScope row representing a
 * mid-session scope switch (Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md §C.4).
 *
 * Validates that the user actually still holds the target binding.
 * Throws `ScopeSwitchDenied` when the binding is missing or revoked —
 * caller surfaces this as a 403 to the client.
 */

import { buildAuditLink } from '../audit/audit-chain-link.js';
import type {
  SessionScope,
  UserBindingLike,
} from '../types.js';

export class ScopeSwitchDenied extends Error {
  override readonly name = 'ScopeSwitchDenied';
  readonly code: 'binding_revoked' | 'binding_missing' | 'cross_tenant';
  constructor(
    code: 'binding_revoked' | 'binding_missing' | 'cross_tenant',
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export interface SwitchScopeInput {
  readonly previous_session: SessionScope;
  readonly target_scope_id: string | null;
  readonly target_binding: UserBindingLike | undefined;
  readonly nowIso?: string;
  readonly previousAuditHash?: string;
}

export function switchScope(input: SwitchScopeInput): SessionScope {
  const binding = input.target_binding;
  if (!binding) {
    throw new ScopeSwitchDenied(
      'binding_missing',
      `User ${input.previous_session.user_id} does not hold a binding for scope ${
        input.target_scope_id ?? 'tenant_root'
      }.`,
    );
  }
  if (binding.revoked_at !== null) {
    throw new ScopeSwitchDenied(
      'binding_revoked',
      `Binding ${binding.id} was revoked at ${binding.revoked_at}.`,
    );
  }
  if (binding.tenant_id !== input.previous_session.tenant_id) {
    throw new ScopeSwitchDenied(
      'cross_tenant',
      `Binding ${binding.id} belongs to a different tenant.`,
    );
  }

  const switched_at = input.nowIso ?? new Date().toISOString();
  const new_active_scope_id =
    binding.scope_kind === 'tenant_root' ? null : binding.org_unit_id;

  const payload = {
    kind: 'session_scope_switched',
    session_id: input.previous_session.session_id,
    tenant_id: input.previous_session.tenant_id,
    user_id: input.previous_session.user_id,
    switched_from_scope_id: input.previous_session.active_scope_id,
    switched_to_scope_id: new_active_scope_id,
    role_at_active_scope: binding.role,
    authority_tier_max: binding.authority_tier_max,
    switched_at,
  } as const;

  const link = buildAuditLink({
    payload,
    ...(input.previousAuditHash !== undefined
      ? { previousHash: input.previousAuditHash }
      : {}),
    sealedAtIso: switched_at,
  });

  return {
    session_id: input.previous_session.session_id,
    tenant_id: input.previous_session.tenant_id,
    user_id: input.previous_session.user_id,
    active_scope_id: new_active_scope_id,
    role_at_active_scope: binding.role,
    authority_tier_max: binding.authority_tier_max,
    origin: 'mid_session_switch',
    switched_from_scope_id: input.previous_session.active_scope_id,
    switched_at,
    audit_hash: link.rowHash,
    established_at: input.previous_session.established_at,
    expires_at: input.previous_session.expires_at,
  };
}
