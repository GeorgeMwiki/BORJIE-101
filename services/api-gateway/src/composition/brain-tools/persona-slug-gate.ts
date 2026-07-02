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
 * Canonical role-token vocabulary, per persona tier (all UPPER-CASE).
 *
 * The gate is fed from TWO callsites, each carrying a DIFFERENT token dialect:
 *
 *   1. The orchestrator `ToolExecutionContext.actor.roles` — the RAW auth /
 *      Supabase `app_metadata.roles[]` strings (`admin`, `super_admin`,
 *      `borjie_team`, `support`, `site_manager`, `driver`, `buyer_org_admin`,
 *      …) — i.e. the same `match` tokens the auth middleware's `ROLE_PRIORITY`
 *      table keys on (auth/supabase/supabase-auth-middleware.ts).
 *   2. The persona-kernel-bridge — the mapped RBAC role NAMES
 *      (`OWNER` / `PLATFORM_ADMIN` / `MANAGER` / `CUSTOMER`).
 *
 * The prior matcher recognised ONLY the RBAC dialect (`OWNER` / `TENANT_ADMIN`
 * / `PLATFORM_ADMIN` / `MANAGER` / `WORKER` / `EMPLOYEE` / `CUSTOMER` / `BUYER`),
 * so a REAL admin / super-admin / Borjie-team / support / site-manager caller
 * arriving via callsite (1) matched NOTHING and was silently downgraded to the
 * least-privileged `T5_customer_concierge` — locked out of their own tools.
 * These sets fold BOTH dialects in so the auth-layer token set and the RBAC
 * name set both resolve to the correct tier, while a genuinely UNKNOWN /
 * unmapped token still falls through to the fail-closed T5 default.
 *
 * A token appears in exactly ONE tier; tiers are checked highest-privilege
 * first so a caller holding several roles resolves to the highest AUTHORIZED
 * persona.
 */
const T1_OWNER_TOKENS: ReadonlySet<string> = new Set(['OWNER']);

const T2_ADMIN_TOKENS: ReadonlySet<string> = new Set([
  // RBAC name dialect (persona-kernel-bridge)
  'TENANT_ADMIN',
  'PLATFORM_ADMIN',
  // Raw auth / Supabase dialect (orchestrator actor.roles)
  'ADMIN',
  'SUPER_ADMIN',
  'BORJIE_TEAM',
  'SUPPORT',
]);

const T3_MANAGER_TOKENS: ReadonlySet<string> = new Set([
  'MANAGER',
  'PROPERTY_MANAGER',
  'SITE_MANAGER',
  // Privileged non-owner functional role — treated as a module manager, never
  // an owner-tier ceiling.
  'ACCOUNTANT',
]);

const T4_FIELD_TOKENS: ReadonlySet<string> = new Set([
  'WORKER',
  'EMPLOYEE',
  'MAINTENANCE_STAFF',
  'MAINTENANCE',
  'DRIVER',
]);

const T5_CUSTOMER_TOKENS: ReadonlySet<string> = new Set([
  'CUSTOMER',
  'BUYER',
  'BUYER_ORG_ADMIN',
  'BUYER_ORG_MEMBER',
  'RESIDENT',
]);

/** True when the candidate set intersects the tier's token set. */
function hasAny(candidates: ReadonlySet<string>, tier: ReadonlySet<string>): boolean {
  for (const token of tier) {
    if (candidates.has(token)) return true;
  }
  return false;
}

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
  // Highest-privilege AUTHORIZED persona wins. Each tier folds BOTH the raw
  // auth-layer token dialect and the mapped RBAC-name dialect (see the token
  // sets above), so a real admin / super-admin / Borjie-team / support /
  // site-manager caller resolves to the correct tier instead of being
  // downgraded to T5.
  if (hasAny(candidates, T1_OWNER_TOKENS)) return 'T1_owner_strategist';
  if (hasAny(candidates, T2_ADMIN_TOKENS)) return 'T2_admin_strategist';
  if (hasAny(candidates, T3_MANAGER_TOKENS)) return 'T3_module_manager';
  if (hasAny(candidates, T4_FIELD_TOKENS)) return 'T4_field_employee';
  if (hasAny(candidates, T5_CUSTOMER_TOKENS)) return 'T5_customer_concierge';
  // Fail-closed default — a genuinely unknown / role-less non-owner caller gets
  // the least-privileged persona (NEVER the owner-tier ceiling).
  return 'T5_customer_concierge';
}
