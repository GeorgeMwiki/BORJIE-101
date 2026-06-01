import { redirect } from 'next/navigation';
import { sanitizeNext } from '@/lib/safe-next';

export const dynamic = 'force-dynamic';

interface LoginRedirectProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Legacy `/login` → canonical `/sign-in` redirect.
 *
 * The Supabase-backed `/sign-in` surface is now the single sign-in entry
 * point for the Borjie Console; the old cookie-session `/login` form was
 * retired. This route is kept only as a permanent redirect so existing
 * bookmarks and any stale deep-links (e.g. `/login?next=…`) land on the
 * canonical form with their `next` target preserved.
 */
export default async function LoginPage({ searchParams }: LoginRedirectProps) {
  const params = await searchParams;
  const rawNext = params.next;
  const next = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  // Reject protocol-relative / backslash-smuggled targets before forwarding.
  const safeNext = sanitizeNext(next);
  const target =
    safeNext !== '/'
      ? `/sign-in?next=${encodeURIComponent(safeNext)}`
      : '/sign-in';
  redirect(target);
}
