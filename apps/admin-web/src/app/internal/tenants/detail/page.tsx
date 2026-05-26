import { redirect } from 'next/navigation';

/**
 * Legacy `/internal/tenants/detail` route — kept as a 308 redirect to
 * the tenants list page so deep-links from earlier builds still
 * resolve. The detail surface now lives at `/internal/tenants/[id]`
 * and requires picking a tenant from the list (no synthetic default).
 */
export default function LegacyTenantDetailPage(): never {
  redirect('/internal/tenants');
}
