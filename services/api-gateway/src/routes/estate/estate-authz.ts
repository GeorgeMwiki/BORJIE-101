/**
 * Estate-OS server-side authorization guard (the SINGLE source of truth).
 *
 * The estate routers (groups / entities / assets / capital-movements /
 * succession-plans) serve OWNER-ONLY estate data: succession plans, the
 * asset register, intercompany capital movements, holdings, family-office
 * groups. Before this guard, the ONLY gate on these routes was the
 * front-end chrome — any authenticated tenant principal (a field worker,
 * an accountant, a marketplace buyer holding a valid Supabase JWT) could
 * reach a mounted estate route directly and read or mutate another role's
 * owner-only estate data. A front-end gate is not an authorization
 * boundary; this guard makes the boundary server-side.
 *
 * Two layers, BOTH required, both already wired by the routers that import
 * this:
 *   1. TENANT SCOPE — `databaseMiddleware` binds the `app.current_tenant_id`
 *      GUC so FORCE-RLS on every estate_* table filters to the caller's own
 *      tenant. The routers ALSO carry an explicit `eq(table.tenantId, …)`
 *      predicate. Tenant scope comes from the verified session / RLS GUC,
 *      NEVER from a client-supplied id.
 *   2. ROLE — this guard. Re-invoked on EVERY estate request (it is a
 *      router-level `app.use('*', …)` middleware, not a doc-comment), it
 *      fails CLOSED: only the owner-class principals below pass; every
 *      other tenant role (field worker, buyer, support-less staff) gets a
 *      403 FORBIDDEN from `requireRole`.
 *
 * Role allowlist — the owner-class set that may see owner-only estate data:
 *   - OWNER         — the mining owner (the cockpit principal)
 *   - TENANT_ADMIN  — the tenant `admin` (org administrator)
 *   - SUPER_ADMIN   — Borjie platform staff (`super_admin` / `borjie_team`),
 *                     who operate across tenants for support
 *   - ADMIN         — platform admin staff
 *   - PLATFORM_ADMIN — the INTERNAL persona-tool loopback principal. The
 *                     owner's brain (`T1_owner_strategist`) reads its OWN
 *                     estate data through the loopback HTTP client
 *                     (`brain-tools/loopback-http-client.ts`), which mints a
 *                     short-lived service token signed with the gateway's own
 *                     `JWT_SECRET` carrying `role: 'PLATFORM_ADMIN'` +
 *                     `src: 'persona-tool-loopback'`, tenant-scoped via the
 *                     per-call ALS context. This is a trusted gateway-internal
 *                     principal, NOT a tenant-supplied role — the real
 *                     Supabase role mapper NEVER emits `PLATFORM_ADMIN`, so a
 *                     browser/JWT caller cannot forge it. Without it the
 *                     owner-estate brain tools would 403 against their own data.
 * Tenant-side non-owner roles (PROPERTY_MANAGER / site-manager, ACCOUNTANT,
 * MAINTENANCE_STAFF / field worker, RESIDENT / buyer, SUPPORT) are
 * intentionally absent and fail CLOSED.
 *
 * The role comes from the TRUSTED, server-mapped `auth.role` that
 * `authMiddleware` derives from the verified JWT's `app_metadata.mining_role`
 * (never `user_metadata`, which is user-writable). `requireRole` reads only
 * that trusted field.
 */

import { requireRole } from '../../middleware/hono-auth';
import { UserRole } from '../../types/user-role';

/**
 * The internal persona-tool loopback principal role string. Not a
 * tenant-facing `UserRole` (the Supabase role mapper never emits it); it is
 * minted only by the gateway's own loopback client. Allowed so the owner's
 * brain can read the owner's own estate data through the shared HTTP path.
 */
const PERSONA_LOOPBACK_ROLE = 'PLATFORM_ADMIN' as UserRole;

/**
 * The owner-class roles allowed to read/mutate owner-only estate data.
 * Mirrors the canonical owner-scoped allowlist used by the user-management
 * routes (`users.hono.ts`), plus the gateway-internal loopback principal.
 */
export const ESTATE_OWNER_ROLES: ReadonlyArray<UserRole> = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.TENANT_ADMIN,
  UserRole.OWNER,
  PERSONA_LOOPBACK_ROLE,
];

/**
 * Router-level estate authorization guard. Mount immediately AFTER
 * `authMiddleware` (so `auth.role` is populated) and BEFORE any handler.
 * Fails CLOSED with 403 for any principal outside `ESTATE_OWNER_ROLES`.
 *
 * Returns a fresh middleware instance per call (Hono middleware are not
 * shared across router trees), so call it inline at each `app.use` site.
 */
export const requireEstateOwner = () => requireRole(...ESTATE_OWNER_ROLES);
