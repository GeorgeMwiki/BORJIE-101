/**
 * Pure persona-slug resolution for the persona-tool authorization gate.
 *
 * SECURITY (vertical BFLA, own-tenant-bounded): the persona slug bounds the
 * tool CEILING a brain turn may reach (`buildPersonaToolHandlers` gates each
 * WRITE tool on the resolved slug). The slug MUST be derived from the
 * AUTH-derived role SET, never a field that defaults to the highest persona.
 *
 * The prior gate read a NON-EXISTENT `actor.role` (singular) — `AIActor` types
 * `roles?: string[]` — so the read was always `undefined` and every caller fell
 * through to `T1_owner_strategist` (owner-tier ceiling). This helper reads the
 * real `roles` array (plus a back-compat structural `role` some callers attach)
 * and, crucially, FAILS CLOSED: an unresolvable / role-less caller gets the
 * LEAST-privileged persona (`T5_customer_concierge`), never the owner tier.
 */

/** Actor shape the persona gate inspects — both the typed and back-compat fields. */
export interface PersonaGateActorLike {
  readonly roles?: unknown;
  readonly role?: unknown;
}

/** The five persona-tier slugs the persona-tool catalog gates on. */
export type PersonaSlug =
  | 'T1_owner_strategist'
  | 'T2_admin_strategist'
  | 'T3_module_manager'
  | 'T4_field_employee'
  | 'T5_customer_concierge';

/**
 * Resolve the canonical persona slug from an actor's AUTH-derived role set.
 *
 * - Reads `actor.roles` (canonical `AIActor.roles: string[]`) FIRST; folds in a
 *   structural `actor.role` (singular) some callers additionally attach.
 * - Case-insensitive.
 * - Highest-privilege AUTHORIZED persona wins when the caller holds several.
 * - Unresolvable / role-less -> `T5_customer_concierge` (fail CLOSED). Never
 *   `T1_owner_strategist`.
 */
export function resolvePersonaSlugFromActor(
  actor: PersonaGateActorLike | undefined,
): PersonaSlug {
  const candidates = new Set<string>();
  if (Array.isArray(actor?.roles)) {
    for (const r of actor.roles) {
      if (typeof r === 'string') candidates.add(r.toUpperCase());
    }
  }
  if (typeof actor?.role === 'string') {
    candidates.add(actor.role.toUpperCase());
  }
  if (candidates.has('OWNER')) return 'T1_owner_strategist';
  if (candidates.has('TENANT_ADMIN') || candidates.has('PLATFORM_ADMIN'))
    return 'T2_admin_strategist';
  if (candidates.has('MANAGER')) return 'T3_module_manager';
  if (candidates.has('WORKER') || candidates.has('EMPLOYEE'))
    return 'T4_field_employee';
  if (candidates.has('CUSTOMER') || candidates.has('BUYER'))
    return 'T5_customer_concierge';
  // Fail-closed default — least-privileged persona for an unresolvable role.
  return 'T5_customer_concierge';
}
