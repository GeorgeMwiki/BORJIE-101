import { RouteSkeleton } from '@/components/shared/RouteSkeleton';

/**
 * Route-level loading placeholder — instant-paint DS Skeleton shell while
 * the server component for this segment streams in (zero layout shift).
 */
export default function Loading() {
  return <RouteSkeleton />;
}
