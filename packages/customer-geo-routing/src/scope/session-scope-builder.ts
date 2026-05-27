/**
 * Session-scope builder — produces a `SessionScope` row from a binding
 * (selected by the picker or auto-resolved) ready for persistence.
 *
 * No I/O. Caller persists the result to `session_scopes` and stamps
 * the matching JWT claims.
 */

import { buildAuditLink } from '../audit/audit-chain-link.js';
import type {
  SessionScope,
  SessionScopeOrigin,
  UserBindingLike,
} from '../types.js';

export interface BuildSessionScopeInput {
  readonly session_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  /** The binding chosen by the picker (or the sole active binding). */
  readonly chosen_binding: UserBindingLike;
  readonly origin: SessionScopeOrigin;
  readonly nowIso?: string;
  readonly expiresAtIso: string;
  readonly previousAuditHash?: string;
}

export function buildSessionScope(input: BuildSessionScopeInput): SessionScope {
  const established_at = input.nowIso ?? new Date().toISOString();
  const active_scope_id =
    input.chosen_binding.scope_kind === 'tenant_root'
      ? null
      : input.chosen_binding.org_unit_id;

  const payload = {
    kind: 'session_scope_established',
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    session_id: input.session_id,
    active_scope_id,
    role_at_active_scope: input.chosen_binding.role,
    authority_tier_max: input.chosen_binding.authority_tier_max,
    origin: input.origin,
    established_at,
    expires_at: input.expiresAtIso,
  } as const;

  const link = buildAuditLink({
    payload,
    ...(input.previousAuditHash !== undefined
      ? { previousHash: input.previousAuditHash }
      : {}),
    sealedAtIso: established_at,
  });

  return {
    session_id: input.session_id,
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    active_scope_id,
    role_at_active_scope: input.chosen_binding.role,
    authority_tier_max: input.chosen_binding.authority_tier_max,
    origin: input.origin,
    audit_hash: link.rowHash,
    established_at,
    expires_at: input.expiresAtIso,
  };
}
