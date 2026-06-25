/**
 * Owner session resolver.
 *
 * Resolves the REAL authenticated owner from the canonical Supabase JWT
 * (CLAUDE.md: "Supabase JWT is canonical auth"). The browser owns the
 * session via the `@supabase/ssr` cookies; the same cookies are
 * forwarded to the gateway, which rehydrates them into the encrypted
 * `borjie-session` cookie + `Authorization: Bearer`. Here on the Next
 * server we read the verified user via `auth.getUser()` (which validates
 * the token against Supabase, not just decodes it) and project its
 * claims onto the `OwnerSession` shape the cockpit renders against.
 *
 * Real, claim-derived fields (authoritative):
 *   - `userId`            ← Supabase `user.id` (the JWT `sub`).
 *   - `tenant.id`         ← `app_metadata.tenant_id` (the same claim the
 *                           gateway's hono-auth binds as the RLS GUC).
 *   - `role`              ← `app_metadata.mining_role` — the cockpit is
 *                           owner-scoped, so a non-owner role redirects
 *                           rather than silently rendering owner chrome.
 *   - `languagePreference`← `user_metadata.language` when set, else the
 *                           `borjie_locale` cookie (single source of
 *                           truth for the active language; default 'en').
 *
 * Display-only fields NOT carried in the JWT (legal/trading name,
 * region, plan, the site list, the owner's salutation) are derived from
 * `user_metadata` when the signup/onboarding flow populated it, else
 * fall back to safe, identity-neutral defaults. These last fields are
 * the ONLY remaining mock surface: hydrating them fully needs a
 * server-reachable tenant-profile read (the gateway already exposes
 * `GET /api/v1/tenants/current`, but it requires the forwarded bearer
 * and a sites endpoint that does not exist yet) — see TODO below.
 *
 * FAIL SAFE / FAIL CLOSED: when there is no user, an invalid token, no
 * tenant claim, OR a `mining_role` that is not owner-class, we DO NOT crash
 * and DO NOT hardcode a role — we `redirect('/sign-in')`. The route
 * middleware only proves a session EXISTS (authentication); the OWNER-role
 * authorization gate is HERE, re-invoked on every render against the
 * `auth.getUser()`-verified claim — never a doc-comment or a
 * middleware-only check. (This also guards the render-time race where the
 * token expired between the middleware check and the RSC render.)
 */

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from './supabase/server';
import { readLocaleFromServerCookies } from './locale.server';
import { requirePublicBaseUrl } from './env-guard';
import { gatewayFetch } from './gateway-result';

/**
 * Roles permitted to render the owner strategic cockpit. The owner-web app
 * is owner-scoped chrome — a workforce actor (driver / supervisor / …), a
 * buyer, or a Borjie-team operator each has their OWN surface and must NOT
 * be served the owner cockpit. Comparison is on the lowercased `mining_role`
 * claim (the WIRE is locale-neutral UPPER/lower-snake codes; the gateway
 * also lowercases before mapping — see supabase-auth-middleware).
 *
 * `owner` is the mining owner; `admin` is the tenant-level administrator who
 * co-pilots the same cockpit. Every other `borjie_user_role` enum value is
 * deliberately excluded so a new workforce role can never silently inherit
 * owner chrome — this is an allowlist, not a denylist.
 */
const COCKPIT_OWNER_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

function isOwnerCockpitRole(miningRole: string | undefined): boolean {
  if (!miningRole) return false;
  return COCKPIT_OWNER_ROLES.has(miningRole.trim().toLowerCase());
}

export interface SiteSummary {
  readonly id: string;
  readonly name: string;
  /** Display-only — sourced from the tenant region (sites have no own region). */
  readonly region: string;
  /**
   * Display-only mineral label. Widened from the original narrow union to a
   * plain string so REAL gateway values (which can be any mineral) render
   * verbatim instead of being coerced into a fabricated bucket.
   */
  readonly mineral: string;
  /** Display-only lifecycle status string from the gateway sites row. */
  readonly status: string;
}

export interface OwnerSession {
  readonly userId: string;
  readonly fullName: string;
  readonly salutation: string;
  readonly languagePreference: 'sw' | 'en';
  readonly role: 'owner';
  readonly tenant: {
    readonly id: string;
    readonly legalName: string;
    readonly tradingName: string;
    readonly region: string;
    readonly plan: 'kampuni' | 'mtu_mmoja' | 'group';
  };
  readonly sites: ReadonlyArray<SiteSummary>;
  readonly activeSiteId: string;
  /**
   * TRUE when the estate hydration (sites / tenant profile) could not be
   * read from the gateway — a FAILURE, not an emptiness. Lets the cockpit
   * render a localised "could not load" affordance instead of an HONEST-but-
   * WRONG "0 sites". Absent/false means the read succeeded (an empty `sites`
   * array is then a genuine empty estate). Defaults to `false`.
   */
  readonly estateLoadError: boolean;
}

/**
 * Defensive parse of the JWT `app_metadata` — the authoritative tenant +
 * role claims. We never trust the shape blindly: a token missing the
 * tenant claim must fail closed, not render a tenant-less cockpit.
 */
const AppMetadataSchema = z
  .object({
    tenant_id: z.string().trim().min(1).optional(),
    mining_role: z.string().trim().min(1).optional(),
  })
  .passthrough();

/**
 * Defensive parse of the editable `user_metadata` — display-only hints
 * the signup/onboarding flow may have stamped. Every field is optional;
 * absence falls back to identity-neutral defaults below.
 */
const UserMetadataSchema = z
  .object({
    full_name: z.string().trim().min(1).optional(),
    salutation: z.string().trim().min(1).optional(),
    language: z.enum(['sw', 'en']).optional(),
    legal_name: z.string().trim().min(1).optional(),
    trading_name: z.string().trim().min(1).optional(),
    region: z.string().trim().min(1).optional(),
    plan: z.enum(['kampuni', 'mtu_mmoja', 'group']).optional(),
  })
  .passthrough();

/** Derive a salutation when one was not stamped — first token of the name. */
function deriveSalutation(fullName: string): string {
  const first = fullName.split(/\s+/).filter(Boolean)[0];
  return first ?? fullName;
}

/** Gateway base URL — same resolver the browser client uses. */
function gatewayBaseUrl(): string {
  return requirePublicBaseUrl(
    'NEXT_PUBLIC_API_GATEWAY_URL',
    'http://localhost:3001',
  ).replace(/\/+$/, '');
}

/**
 * Server-side authed GET against the gateway, forwarding the verified
 * Supabase access token as a bearer. Delegates to the shared typed-result
 * substrate so a FAILURE (network / non-2xx / parse) is distinguishable from
 * an empty-but-valid payload — the caller inspects `result.ok` rather than a
 * collapsed `null`. Never throws; never fabricates data.
 */
function gatewayGet<T>(
  path: string,
  accessToken: string,
): ReturnType<typeof gatewayFetch<T>> {
  return gatewayFetch<T>({
    url: `${gatewayBaseUrl()}${path}`,
    path,
    headers: { Authorization: `Bearer ${accessToken}` },
    // RSC fetch — never cache a per-tenant authed read.
    cache: 'no-store',
    // Server reads stay silent (no console in services); the typed failure is
    // surfaced to the cockpit via `estateLoadError` instead.
  });
}

/** Raw gateway sites row — only the fields the cockpit summary needs. */
const GatewaySiteRowSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    mineral: z.string().optional(),
    status: z.string().optional(),
    updatedAt: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/** Raw `GET /api/v1/tenants/current` projection — display fields only. */
const TenantCurrentSchema = z
  .object({
    name: z.string().optional(),
    region: z.string().optional(),
    subscription: z
      .object({ plan: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** Map the gateway's free-form plan/tier onto the cockpit plan union. */
function mapPlan(
  raw: string | undefined,
): 'kampuni' | 'mtu_mmoja' | 'group' | undefined {
  if (raw === 'kampuni' || raw === 'mtu_mmoja' || raw === 'group') return raw;
  return undefined;
}

/**
 * Hydrate the owner's REAL sites + tenant display fields from the gateway.
 * Returns identity-neutral empties (never fabricated) plus a `loadError`
 * flag: when the token is absent or EITHER read fails, `loadError` is true so
 * the cockpit can render a localised "could not load" — distinguishing a
 * transient FAILURE from an honestly-EMPTY estate (an empty `sites` with
 * `loadError:false`). Never fabricates a site list or a plan.
 */
async function hydrateOwnerEstate(
  accessToken: string | undefined,
  tenantRegionFallback: string,
): Promise<{
  readonly sites: ReadonlyArray<SiteSummary>;
  readonly activeSiteId: string;
  readonly region: string;
  readonly plan?: 'kampuni' | 'mtu_mmoja' | 'group';
  readonly legalName?: string;
  /** TRUE when EITHER gateway read failed — a degrade, not an empty estate. */
  readonly loadError: boolean;
}> {
  if (!accessToken) {
    // No bearer is a genuine unauthenticated edge, not a transient failure;
    // the caller already redirected on a missing user. Treat as a load
    // failure so the cockpit never paints a fake-empty estate from no read.
    return {
      sites: [],
      activeSiteId: '',
      region: tenantRegionFallback,
      loadError: true,
    };
  }
  const [tenantResult, sitesResult] = await Promise.all([
    gatewayGet<unknown>('/api/v1/tenants/current', accessToken),
    gatewayGet<unknown>('/api/v1/mining/sites', accessToken),
  ]);

  // A FAILURE on EITHER read is a degrade — the sites array below would
  // otherwise read as an honest "0 sites" when the gateway was simply
  // unreachable. Distinguish failure from emptiness.
  const loadError = !tenantResult.ok || !sitesResult.ok;

  const tenant = tenantResult.ok
    ? TenantCurrentSchema.safeParse(tenantResult.data).data
    : undefined;
  const region = tenant?.region?.trim() || tenantRegionFallback;
  const plan = mapPlan(tenant?.subscription?.plan);

  const rows =
    sitesResult.ok && Array.isArray(sitesResult.data) ? sitesResult.data : [];
  const sites: SiteSummary[] = [];
  for (const r of rows) {
    const parsed = GatewaySiteRowSchema.safeParse(r);
    if (!parsed.success) continue;
    sites.push({
      id: parsed.data.id,
      name: parsed.data.name ?? 'Unnamed site',
      region,
      mineral: parsed.data.mineral ?? 'unspecified',
      status: parsed.data.status ?? 'unknown',
    });
  }

  // The gateway returns sites newest-first (ORDER BY updatedAt DESC), so the
  // first row is the most-recent — a sensible default active site.
  const activeSiteId = sites[0]?.id ?? '';
  return {
    sites,
    activeSiteId,
    region,
    loadError,
    ...(plan ? { plan } : {}),
    ...(tenant?.name ? { legalName: tenant.name } : {}),
  };
}

/**
 * Resolve the active owner session, or redirect to sign-in when there is
 * no valid authenticated owner. Returns a non-null `OwnerSession` so the
 * existing call sites (which never null-checked) stay correct.
 */
/**
 * Per-request memoised session resolver.
 *
 * Wrapped in React's `cache()` so the dashboard can `await` it from
 * several independently-streamed Suspense regions (greeting hero,
 * Owner-OS shell, …) without re-issuing the Supabase `getUser()` /
 * `getSession()` network calls — every caller within one server render
 * shares the single resolution. Behaviour is otherwise identical to the
 * original single-await page.
 */
export const getOwnerSession: () => Promise<OwnerSession> = cache(
  getOwnerSessionUncached,
);

async function getOwnerSessionUncached(): Promise<OwnerSession> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data.user;

  const appMeta = AppMetadataSchema.safeParse(user?.app_metadata ?? {});
  const tenantId = appMeta.success ? appMeta.data.tenant_id : undefined;
  const miningRole = appMeta.success ? appMeta.data.mining_role : undefined;

  // Fail closed: no verified user OR no tenant claim → unauthenticated
  // path. Never hardcode a role to paper over a missing session.
  if (!user || !tenantId) {
    redirect('/sign-in');
  }

  // AUTHZ (re-invoked at render, not a doc-comment): the cockpit is owner-
  // scoped chrome. A verified session whose `mining_role` is NOT an owner-
  // class role (workforce / buyer / borjie_team) must be turned away here —
  // the middleware only proves a session EXISTS, never that the actor owns
  // this surface. Fail CLOSED: an absent or unrecognised role is non-owner
  // and is redirected, never silently elevated. This is the guard the file
  // header promised, now actually written.
  if (!isOwnerCockpitRole(miningRole)) {
    redirect('/sign-in?reason=not-owner');
  }

  const userMeta = UserMetadataSchema.safeParse(user.user_metadata ?? {}).data ?? {};
  const cookieLocale = await readLocaleFromServerCookies();
  const languagePreference = userMeta.language ?? cookieLocale;

  const fullName = userMeta.full_name ?? user.email ?? 'Owner';
  const tradingName = userMeta.trading_name ?? userMeta.legal_name ?? 'Borjie';

  // Hydrate the owner's REAL estate (sites) + tenant display fields from the
  // gateway, forwarding the verified bearer. Degrades to identity-neutral
  // empties on any failure — never fabricates a site list or a plan.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const estate = await hydrateOwnerEstate(accessToken, userMeta.region ?? '');

  return {
    userId: user.id,
    fullName,
    salutation: userMeta.salutation ?? deriveSalutation(fullName),
    languagePreference,
    role: 'owner',
    tenant: {
      id: tenantId,
      legalName: estate.legalName ?? userMeta.legal_name ?? tradingName,
      tradingName,
      region: estate.region,
      // Plan from the live tenant subscription when it maps to a cockpit
      // tier; otherwise the JWT hint, else the conservative single-user tier.
      plan: estate.plan ?? userMeta.plan ?? 'mtu_mmoja',
    },
    sites: estate.sites,
    activeSiteId: estate.activeSiteId,
    estateLoadError: estate.loadError,
  };
}
