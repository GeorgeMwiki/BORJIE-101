import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Sign in — Borjie',
  description: 'Sign in to the Borjie owner portal.',
};

/**
 * Marketing /sign-in is a thin redirect to the owner-web sign-in page.
 *
 * The marketing site (apps/marketing) has no auth surface — sign-in,
 * password reset, and MFA challenge all live on apps/owner-web. The
 * landing-page navbar links to /sign-in for SEO and external-link
 * stability, then bounces here.
 *
 * The target host is `NEXT_PUBLIC_OWNER_PORTAL_URL` — set per
 * environment. Empty string falls back to a relative `/sign-in` which
 * the same-origin reverse-proxy resolves to the owner-web mount. We
 * refuse to hard-code a localhost URL so the deploy artefact stays
 * environment-pure.
 */
export default function SignInRedirect() {
  const target =
    process.env.NEXT_PUBLIC_OWNER_PORTAL_URL?.replace(/\/+$/, '') ?? '';
  // Avoid an infinite redirect loop if the env var is unset.
  // In that case bounce the visitor to /pilot (the canonical CTA);
  // the operator is expected to set NEXT_PUBLIC_OWNER_PORTAL_URL in
  // every non-dev deploy.
  if (!target) {
    redirect('/pilot');
  }
  redirect(`${target}/sign-in`);
}
