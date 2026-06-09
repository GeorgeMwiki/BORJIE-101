import type { ReactElement } from 'react';
import { AdminRouteSkeleton } from '@/components/shared/AdminRouteSkeleton';

/**
 * `loading.tsx` for the `internal/` admin route group.
 *
 * The internal group has its own layout (the react-query provider every
 * internal screen depends on), so it gets its own loading boundary. This
 * paints a layout-stable skeleton the instant an operator opens any of
 * the 20 internal surfaces (tenants, corpus, prompts, killswitch, …)
 * while the real screen streams in behind it.
 */
export default function InternalLoading(): ReactElement {
  return <AdminRouteSkeleton />;
}
