/**
 * Active-tenant override (surface-completion SC-2) — the validated per-request
 * org switch that finally closes the dark synapse: `/me/tenants/active` wrote
 * a `borjie-active-tenant` cookie that NOTHING ever read, so the RLS GUC
 * always bound to the JWT's home tenant. This module is the single reader.
 *
 * HOW IT WORKS (runs inside authMiddleware, after JWT verification, BEFORE
 * the database middleware binds `app.current_tenant_id`):
 *   1. The requested tenant comes from the `X-Borjie-Active-Tenant` header
 *      (mobile Bearer clients) or the `borjie-active-tenant` cookie (web).
 *      Absent / equal to the JWT tenant → no-op.
 *   2. The switch is authorized by the MEMBERSHIP GRAPH, never trusted from
 *      the client: the caller's Supabase sub resolves through
 *      identity_auth_principals → org_memberships, and only an ACTIVE
 *      EMPLOYMENT-CLASS membership (user_id IS NOT NULL) in the target
 *      tenant authorizes it. Buyers are STRUCTURALLY excluded — a
 *      buyer_connection row carries no shadow user (corrected buyer model,
 *      0345), so it can never satisfy this query: an external counterparty
 *      cannot switch into a seller tenant.
 *   3. On success the auth context is rebound: tenantId → the target tenant
 *      AND userId → the membership's SHADOW USER in that tenant (users.id is
 *      a global PK, so the same human is a DIFFERENT users row per tenant —
 *      keeping the JWT sub would mis-attribute every per-user read/write).
 *   4. On failure: FAIL-CLOSED 403 (`TENANT_SWITCH_INVALID`). A silent
 *      fallback to the home tenant would be a confused-deputy hazard (the
 *      user believes they act in org B while writes land in org A). The 403
 *      also clears the cookie so the next request self-heals onto the home
 *      tenant.
 *
 * CACHING: one indexed query per (sub, tenant) with a 60s in-process TTL —
 * membership revocation (leave/revoke/block) therefore propagates to open
 * sessions within ≤60s, the documented bound. The cache is capped and
 * cleared wholesale when full (no LRU bookkeeping on the hot path).
 */

import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';

export const ACTIVE_TENANT_COOKIE_NAME = 'borjie-active-tenant';
export const ACTIVE_TENANT_HEADER_NAME = 'X-Borjie-Active-Tenant';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 5_000;

type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

interface SwitchGrant {
  readonly tenantId: string;
  readonly shadowUserId: string;
}

type CacheEntry = {
  readonly expiresAtMs: number;
  readonly grant: SwitchGrant | 'denied';
  readonly gen: number;
};

const cache = new Map<string, CacheEntry>();

// SCALING (S-5): invalidate via a generation counter instead of a wholesale
// `cache.clear()`. A revoke/block/switch bumps the generation; any entry
// stamped with an older generation is treated as a miss on read. This is
// O(1) and avoids the cache-stampede thrash a wholesale clear causes when
// many concurrent requests miss simultaneously under load. The Map is still
// capped (CACHE_MAX_ENTRIES) and self-expires by TTL, so stale-generation
// entries are reclaimed lazily on access / when the cap is hit.
let cacheGeneration = 0;

/** Test seam + revocation hook (me-tenants / membership routes bust on
 *  explicit switch and on org-side revoke/block). O(1) — bumps the
 *  generation so every prior grant is treated as stale. */
export function clearActiveTenantCache(): void {
  cacheGeneration += 1;
}

function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}

/** The client's requested active tenant: header (mobile) wins over cookie. */
export function readRequestedActiveTenant(c: Context): string | null {
  const header = c.req.header(ACTIVE_TENANT_HEADER_NAME);
  if (header && header.trim().length > 0) return header.trim();
  return readCookieValue(c.req.header('Cookie'), ACTIVE_TENANT_COOKIE_NAME);
}

/**
 * The membership authorization query. Service-role lifts RLS row visibility
 * for the cross-tenant read; the explicit WHERE (sub + tenant + ACTIVE +
 * shadow-user present) is the real gate. Exported for the /me/tenants
 * switch endpoint to share the exact same predicate.
 */
export async function verifyEmploymentMembershipForTenant(
  db: ServiceRoleDb,
  supabaseUserId: string,
  tenantId: string,
): Promise<SwitchGrant | null> {
  const rows = (await withServiceRoleContext(db, (sdb) =>
    (sdb as unknown as { execute(q: unknown): Promise<unknown> }).execute(sql`
      SELECT m.platform_tenant_id AS tenant_id, m.user_id AS shadow_user_id
        FROM identity_auth_principals iap
        JOIN org_memberships m
          ON m.tenant_identity_id = iap.tenant_identity_id
       WHERE iap.supabase_user_id = ${supabaseUserId}::uuid
         AND m.platform_tenant_id = ${tenantId}
         AND m.status = 'ACTIVE'
         AND m.user_id IS NOT NULL
       LIMIT 1
    `),
  )) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) return null;
  return {
    tenantId: String(row.tenant_id),
    shadowUserId: String(row.shadow_user_id),
  };
}

export type ActiveTenantResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'switched'; readonly grant: SwitchGrant }
  | { readonly kind: 'denied'; readonly requestedTenantId: string };

/**
 * Resolve the override for an authenticated request. `db` is the pooled
 * client (the request connection is not pinned yet at auth time); absent a
 * database the switch is DENIED (fail-closed), never silently ignored.
 */
export async function resolveActiveTenantOverride(args: {
  readonly c: Context;
  readonly db: ServiceRoleDb | null | undefined;
  readonly supabaseUserId: string;
  readonly jwtTenantId: string;
}): Promise<ActiveTenantResolution> {
  const requested = readRequestedActiveTenant(args.c);
  if (!requested || requested === args.jwtTenantId) {
    return { kind: 'none' };
  }
  const cacheKey = `${args.supabaseUserId}:${requested}`;
  const cached = cache.get(cacheKey);
  // Fresh ONLY if within TTL AND stamped with the current generation (a
  // revoke/block/switch bumps the generation → older entries are stale).
  if (
    cached &&
    cached.gen === cacheGeneration &&
    cached.expiresAtMs > Date.now()
  ) {
    return cached.grant === 'denied'
      ? { kind: 'denied', requestedTenantId: requested }
      : { kind: 'switched', grant: cached.grant };
  }
  if (!args.db) {
    // Fail closed without poisoning the cache — a transient missing client
    // must not deny the switch for the next 60s.
    return { kind: 'denied', requestedTenantId: requested };
  }
  let grant: SwitchGrant | null = null;
  try {
    grant = await verifyEmploymentMembershipForTenant(
      args.db,
      args.supabaseUserId,
      requested,
    );
  } catch {
    // Query failure = unverifiable = fail closed, uncached (transient).
    return { kind: 'denied', requestedTenantId: requested };
  }
  // Cap is a hard bound; when hit, drop the map wholesale (rare, not the
  // hot path — the generation counter handles routine invalidation).
  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(cacheKey, {
    expiresAtMs: Date.now() + CACHE_TTL_MS,
    grant: grant ?? 'denied',
    gen: cacheGeneration,
  });
  return grant
    ? { kind: 'switched', grant }
    : { kind: 'denied', requestedTenantId: requested };
}

/** The self-healing cookie clear attached to a 403 denial. */
export function expiredActiveTenantCookie(): string {
  return [
    `${ACTIVE_TENANT_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
}
