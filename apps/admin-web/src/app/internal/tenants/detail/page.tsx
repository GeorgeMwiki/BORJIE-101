import { redirect } from 'next/navigation';
import { MOCK_TENANTS } from '@/lib/mocks/tenants';

/**
 * Legacy `/internal/tenants/detail` route — kept as a 308 redirect to
 * the new `[id]` page so deep-links from earlier builds still resolve.
 * Picks the first tenant in the seed list as a sensible default.
 */
export default function LegacyTenantDetailPage(): never {
  const fallback = MOCK_TENANTS[0]?.id ?? 'tnt_geita_dhahabu';
  redirect(`/internal/tenants/${fallback}`);
}
