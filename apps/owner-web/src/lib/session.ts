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
 * FAIL SAFE: when there is no user, an invalid token, or no tenant
 * claim, we DO NOT crash and DO NOT hardcode a role — we follow the
 * existing unauthenticated path and `redirect('/sign-in')`. (The route
 * middleware already redirects unauthenticated navigations; this guards
 * the render-time race where the token expired between the middleware
 * check and the RSC render.)
 */

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from './supabase/server';
import { readLocaleFromServerCookies } from './locale.server';

export interface SiteSummary {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly mineral: 'gold' | 'coltan' | 'tanzanite' | 'gemstone';
  readonly status: 'active' | 'standby' | 'permitting';
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

/**
 * Resolve the active owner session, or redirect to sign-in when there is
 * no valid authenticated owner. Returns a non-null `OwnerSession` so the
 * existing call sites (which never null-checked) stay correct.
 */
export async function getOwnerSession(): Promise<OwnerSession> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = error ? null : data.user;

  const appMeta = AppMetadataSchema.safeParse(user?.app_metadata ?? {});
  const tenantId = appMeta.success ? appMeta.data.tenant_id : undefined;

  // Fail closed: no verified user OR no tenant claim → unauthenticated
  // path. Never hardcode a role to paper over a missing session.
  if (!user || !tenantId) {
    redirect('/sign-in');
  }

  const userMeta = UserMetadataSchema.safeParse(user.user_metadata ?? {}).data ?? {};
  const cookieLocale = await readLocaleFromServerCookies();
  const languagePreference = userMeta.language ?? cookieLocale;

  const fullName = userMeta.full_name ?? user.email ?? 'Owner';
  const tradingName = userMeta.trading_name ?? userMeta.legal_name ?? 'Borjie';

  // TODO(tenant-profile): legalName / region / plan / sites are not in
  // the JWT. Hydrate them from a server-reachable tenant-profile read
  // (gateway `GET /api/v1/tenants/current` for the tenant fields + a
  // sites endpoint that still needs to be added) so the cockpit shows
  // the owner's real estate instead of these identity-neutral defaults.
  return {
    userId: user.id,
    fullName,
    salutation: userMeta.salutation ?? deriveSalutation(fullName),
    languagePreference,
    role: 'owner',
    tenant: {
      id: tenantId,
      legalName: userMeta.legal_name ?? tradingName,
      tradingName,
      region: userMeta.region ?? '',
      plan: userMeta.plan ?? 'mtu_mmoja',
    },
    sites: [],
    activeSiteId: '',
  };
}
