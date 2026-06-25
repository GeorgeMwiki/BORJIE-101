import { redirect } from 'next/navigation';

/**
 * Owner-web root (`/`) — redirects to `/dashboard`.
 *
 * The portal-root redirect pattern.
 * The chat surface that previously lived here is reachable from the
 * sidebar's "Ask Borjie" and "Master Brain" entries.
 */
export default function OwnerRootPage(): never {
  redirect('/dashboard');
}
