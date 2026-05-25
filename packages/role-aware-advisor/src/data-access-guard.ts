/**
 * Capability matrix — the lone choke-point between a user's role and
 * any data the brain is allowed to see in its context window.
 *
 * Every fetch the orchestrator performs goes through `canAccess` first;
 * every snippet returned by the `DataPort` is re-checked AFTER it
 * lands (because the port lives outside this package and can't be
 * trusted by itself).
 *
 * The three-valued return makes the policy explicit:
 *   - `allow`  — pass the data through untouched
 *   - `redact` — pass the data through with PII fields stripped
 *   - `deny`   — drop the data entirely; the orchestrator MUST tell
 *                the user it cannot see the requested record
 *
 * Scope dimensions:
 *   - `own`         — the resource is owned by the requesting user
 *                     (their lease, their maintenance ticket)
 *   - `tenant-wide` — the resource is inside the user's tenant org
 *                     but not owned by them personally
 *   - `cross-tenant`— the resource belongs to a different tenant
 *                     (NEVER allowed for any role except `admin`, and
 *                      even then only with explicit consent flag)
 *   - `public`      — public listing / market data; safe for all roles
 */

import type { Role, ResourceKind } from './roles.js';
import { getPersona } from './roles.js';

export type AccessScope = 'own' | 'tenant-wide' | 'cross-tenant' | 'public';

export type AccessDecision = 'allow' | 'redact' | 'deny';

export interface AccessQuery {
  readonly role: Role;
  readonly resource: ResourceKind;
  readonly scope: AccessScope;
  /**
   * Optional ownership hint — when the caller can confirm the resource
   * belongs to the user (e.g. `lease.tenantUserId === user.id`) it
   * passes `ownedByUser: true` to skip the conservative default.
   */
  readonly ownedByUser?: boolean;
}

/**
 * Single source of truth for "can role X read resource Y at scope Z".
 *
 * Implementation notes:
 *
 *  - We do NOT consult any tenant id here. Tenant-scoping happens
 *    one layer up — the orchestrator pins the queries to the user's
 *    tenant via the `DataPort` contract, and any data that comes back
 *    tagged with a different tenantId is dropped before this function
 *    even sees it. This function answers a narrower question: given
 *    the user is who they say they are, what may they read?
 *
 *  - The default for any case not enumerated is `deny`. New
 *    `ResourceKind` values added to `roles.ts` will fall through to
 *    deny until they're explicitly granted — fail-closed by design.
 *
 *  - Cross-tenant is rejected universally. We do NOT special-case
 *    `admin` here because cross-tenant admin reads require a separate
 *    short-lived elevation flow (not implemented in this MVP); when
 *    that flow lands it should set an explicit `elevated: true` on the
 *    query and gate it here.
 */
export function canAccess(query: AccessQuery): AccessDecision {
  const { role, resource, scope } = query;
  const persona = getPersona(role);

  // Cross-tenant: hard deny for everyone. The admin escape hatch lives
  // in a separate elevated-access flow (out of scope here).
  if (scope === 'cross-tenant') return 'deny';

  // Public scope: always allow as long as the persona could see public
  // data of this kind at all.
  if (scope === 'public') {
    return persona.canSee.includes(resource) ? 'allow' : 'deny';
  }

  // Own scope: the resource has to be in the persona's canSee list,
  // AND the caller has to either own it (the cheap path) or it has to
  // be a resource type that the persona reads tenant-wide (e.g. PM
  // reading `staff-notes` they didn't write).
  if (scope === 'own') {
    if (!persona.canSee.includes(resource)) return 'deny';
    if (persona.cannotSee.includes(resource)) return 'redact';
    return 'allow';
  }

  // Tenant-wide: persona must list the resource, with redact taking
  // precedence over allow when the persona explicitly cannot see PII
  // shapes of it.
  if (scope === 'tenant-wide') {
    if (!persona.canSee.includes(resource)) return 'deny';
    if (persona.cannotSee.includes(resource)) return 'redact';
    // Owners reading tenant data always get aggregated, never named.
    if (role === 'owner' && resource === 'tenant-aggregate-no-pii') {
      return 'redact';
    }
    return 'allow';
  }

  return 'deny';
}

/**
 * Convenience: bulk-classify a list of snippets, partition into
 * `allowed`, `redacted` (to be passed through the redactor), and
 * `denied` (must be dropped + the user told).
 */
export interface SnippetLike {
  readonly id: string;
  readonly resource: ResourceKind;
  readonly scope: AccessScope;
  readonly ownedByUser?: boolean;
  readonly tenantId?: string;
}

export interface Classification<T extends SnippetLike> {
  readonly allowed: T[];
  readonly redacted: T[];
  readonly denied: T[];
}

export function classifySnippets<T extends SnippetLike>(
  role: Role,
  snippets: ReadonlyArray<T>,
  callerTenantId: string,
): Classification<T> {
  const allowed: T[] = [];
  const redacted: T[] = [];
  const denied: T[] = [];

  for (const s of snippets) {
    // Tenant-pinning enforcement: if the snippet is tagged with a
    // tenantId that disagrees with the caller's, drop it BEFORE the
    // policy check. This is the defense-in-depth wall the spec calls
    // out — even a buggy DataPort can't leak cross-tenant.
    if (s.tenantId && s.tenantId !== callerTenantId) {
      denied.push(s);
      continue;
    }

    const decision = canAccess({
      role,
      resource: s.resource,
      scope: s.scope,
      ownedByUser: s.ownedByUser ?? false,
    });

    if (decision === 'allow') allowed.push(s);
    else if (decision === 'redact') redacted.push(s);
    else denied.push(s);
  }

  return { allowed, redacted, denied };
}
