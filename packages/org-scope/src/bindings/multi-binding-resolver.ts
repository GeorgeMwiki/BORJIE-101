/**
 * Multi-binding resolver (Wave 18X §3 + §6).
 *
 * A user can hold multiple bindings — e.g. an admin assigned to two
 * districts. When a request comes in, we need to know WHICH binding is
 * active. There are two strategies:
 *
 *   1. **explicit** — the client passed an `X-Borjie-Active-Binding` id
 *      because the user clicked the context switcher in the UI.
 *   2. **implicit** — pick the "most powerful" binding (highest
 *      authority_tier_max; tenant_root > org_unit > cross_scope on
 *      ties; most-recently-granted breaks remaining ties).
 *
 * The owner / admin portal always presents the switcher when a user
 * has >1 binding. The manager / worker / buyer / customer apps assume
 * a single binding and silently use implicit selection.
 */

import type { ScopeKind, UserScopeBinding } from '../types.js';

const SCOPE_KIND_ORDER: Record<ScopeKind, number> = {
  tenant_root: 0,
  org_unit: 1,
  cross_scope: 2,
};

export interface PickBindingInput {
  readonly bindings: ReadonlyArray<UserScopeBinding>;
  readonly preferredBindingId?: string;
}

export interface PickBindingResult {
  readonly active: UserScopeBinding | null;
  readonly strategy: 'explicit' | 'implicit' | 'none';
}

export function pickActiveBinding(input: PickBindingInput): PickBindingResult {
  const active = input.bindings.filter((b) => b.revoked_at === null);
  if (active.length === 0) {
    return { active: null, strategy: 'none' };
  }

  if (input.preferredBindingId !== undefined) {
    const match = active.find((b) => b.id === input.preferredBindingId);
    if (match !== undefined) {
      return { active: match, strategy: 'explicit' };
    }
  }

  // Implicit pick: sort by (tier desc, scope-kind asc, granted_at desc).
  const sorted = [...active].sort((a, b) => {
    if (a.authority_tier_max !== b.authority_tier_max) {
      return b.authority_tier_max - a.authority_tier_max;
    }
    const kindDelta = SCOPE_KIND_ORDER[a.scope_kind] - SCOPE_KIND_ORDER[b.scope_kind];
    if (kindDelta !== 0) {
      return kindDelta;
    }
    return b.granted_at.localeCompare(a.granted_at);
  });
  const chosen = sorted[0] ?? null;
  return { active: chosen, strategy: chosen === null ? 'none' : 'implicit' };
}
