import type { ReactElement } from 'react';
import { AdminRouteSkeleton } from '@/components/shared/AdminRouteSkeleton';

/**
 * Root `loading.tsx` for the admin console.
 *
 * Next.js renders this instantly on navigation between top-level admin
 * segments (audit, tenants, system-health, control-tower, …) and as the
 * Suspense fallback while each segment's server component streams in.
 * One skeleton at the app root covers every top-level surface without
 * per-route duplication; the `internal/` group has its own nested
 * `loading.tsx` for its react-query layout boundary. CLS stays at zero
 * because the header/KPI/panel boxes are pre-reserved.
 */
export default function AdminLoading(): ReactElement {
  return <AdminRouteSkeleton />;
}
