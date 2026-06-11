import type { ReactElement } from 'react';
import { RouteSkeleton } from '@/components/shared/RouteSkeleton';

/**
 * Group-level `loading.tsx` for every `(routes)` segment.
 *
 * Next.js renders this instantly on navigation (and as the Suspense
 * fallback for the segment's server component) so the owner sees a
 * layout-stable skeleton the moment they click a link, while the real
 * page streams in behind it. Sharing one skeleton at the group root
 * covers all 35 owner surfaces without per-route duplication; the
 * `PageHero`-shaped header keeps CLS at zero.
 *
 * Also unlocks Next's partial-prefetch of the static prefix on
 * <Link> hover, so the static chrome is already in the cache when the
 * owner navigates.
 */
export default function RoutesLoading(): ReactElement {
  return <RouteSkeleton />;
}
