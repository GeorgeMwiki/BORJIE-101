/**
 * Scoped MD factory (Wave 18X §5).
 *
 * Produces the `ScopedOrgUserDataContext` an MD kernel turn needs to
 * reason against a specific scope. The persona ("Mr. Mwikila") is the
 * same across all scopes — only the surrounding context shifts.
 *
 * This package owns the *factory*; the cognitive-engine wave (18T) and
 * the agent-platform wave will consume `ScopedOrgUserDataContext` and
 * propagate it through every kernel call.
 *
 * The factory is pure: it takes an already-resolved `ResolvedScope`
 * and decorates it with the canonical persona constants. The cognitive
 * engine will later attach budget meters, observability hooks, and
 * trace ids.
 */

import type { ResolvedScope } from '../types.js';

export interface PersonaIdentity {
  readonly persona_id: string;
  readonly display_name: string;
  readonly mandate: string;
}

export const ROOT_PERSONA: PersonaIdentity = Object.freeze({
  persona_id: 'mr-mwikila',
  display_name: 'Mr. Mwikila',
  mandate:
    'I oversee the whole organisation. I research, I configure tabs, I draft documents, I generate media, I run campaigns — within the scope I have been granted.',
});

/**
 * Where the cognitive engine receives the scope-aware context. Sibling
 * packages can extend this interface in their own modules — every
 * field declared here is *additive* and never mutated.
 */
export interface ScopedOrgUserDataContext {
  readonly persona: PersonaIdentity;
  readonly scope: ResolvedScope;
  readonly visible_table_filter_token: string;
  /**
   * The fully-qualified persona id used in audit chain entries.
   * Combines the persona id and the scope path so cross-scope replays
   * are unambiguous (`mr-mwikila@borjie/north-zone/geita`).
   */
  readonly audit_persona_id: string;
}

export interface BuildScopedMDContextInput {
  readonly scope: ResolvedScope;
  readonly persona?: PersonaIdentity;
}

export function buildScopedMDContext(
  input: BuildScopedMDContextInput,
): ScopedOrgUserDataContext {
  const persona = input.persona ?? ROOT_PERSONA;
  const scope = input.scope;
  const tokenParts: string[] = [`tenant=${scope.tenant_id}`];
  if (scope.kind === 'tenant_root') {
    tokenParts.push('root');
  } else {
    tokenParts.push(`org_units=${scope.org_unit_ids.join(',') || 'none'}`);
  }
  const visibleTableFilterToken = tokenParts.join(';');

  const scopePath = scope.resolved_terminology.scope_path;
  const auditPersonaId =
    scopePath === null
      ? `${persona.persona_id}@${scope.tenant_id}`
      : `${persona.persona_id}@${scopePath}`;

  return {
    persona,
    scope,
    visible_table_filter_token: visibleTableFilterToken,
    audit_persona_id: auditPersonaId,
  };
}
