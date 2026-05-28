import { redirect } from 'next/navigation';

/**
 * Owner-web root (`/`) — redirects to `/dashboard`.
 *
 * Mirrors LitFin's `(borrower)/borrower/page.tsx` redirect pattern.
 * The chat surface that previously lived here is reachable from the
 * sidebar's "Ask Borjie" and "Master Brain" entries.
 */
export default function OwnerRootPage(): never {
  redirect('/dashboard');
}
