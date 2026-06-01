import { redirect } from 'next/navigation';

import { requirePublicBaseUrl } from '@/lib/env-guard';

// Pure redirect — no UI to render and no static cache to keep.
export const dynamic = 'force-dynamic';

/**
 * /sign-in — canonical owner auth lives on owner-web, not here.
 *
 * Owner sign-in was duplicated (marketing /sign-in AND owner-web
 * /sign-in). To keep one source of truth we redirect every hit to the
 * owner cockpit's `/sign-in` on its own origin (port 3010 in dev).
 *
 * `requirePublicBaseUrl` throws in production when
 * NEXT_PUBLIC_OWNER_WEB_ORIGIN is unset, so the deployed marketing
 * site can never silently bounce a visitor to localhost; in dev it
 * falls back to http://localhost:3010. The buyer flow
 * (apps/marketing/src/app/buyers/*) is intentionally left untouched.
 */
export default function SignInPage(): never {
  const ownerWebOrigin = requirePublicBaseUrl(
    'NEXT_PUBLIC_OWNER_WEB_ORIGIN',
    'http://localhost:3010',
  ).replace(/\/$/, '');
  redirect(`${ownerWebOrigin}/sign-in`);
}
