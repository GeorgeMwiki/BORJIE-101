import { redirect } from 'next/navigation';

import { requirePublicBaseUrl } from '@/lib/env-guard';

// Pure redirect — no UI to render and no static cache to keep.
export const dynamic = 'force-dynamic';

/**
 * /signup — canonical owner self-serve sign-up lives on the marketing
 * site, not here.
 *
 * Owner sign-up was duplicated (marketing /sign-up AND owner-web
 * /signup). The marketing /sign-up form is the known-working,
 * end-to-end path (creates user + tenant + persona + audit + session,
 * then lands in the cockpit). To keep one source of truth we redirect
 * every hit to the marketing site's `/sign-up` on its own origin
 * (port 3002 in dev) — mirroring how marketing /sign-in redirects to
 * owner-web /sign-in.
 *
 * `requirePublicBaseUrl` throws in production when
 * NEXT_PUBLIC_MARKETING_ORIGIN is unset, so the deployed cockpit can
 * never silently bounce a visitor to localhost; in dev it falls back
 * to http://localhost:3002. The now-unused SignupWizard components are
 * left in place.
 */
export default function SignupPage(): never {
  const marketingOrigin = requirePublicBaseUrl(
    'NEXT_PUBLIC_MARKETING_ORIGIN',
    'http://localhost:3002',
  ).replace(/\/$/, '');
  redirect(`${marketingOrigin}/sign-up`);
}
