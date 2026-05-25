import dynamic from 'next/dynamic';
import { PortalShell } from '../_lib/PortalShell';
import { AdvisorLoading } from '../_lib/states';

const EstateDepartmentAdvisorClient = dynamic(
  () =>
    import('./EstateDepartmentAdvisorClient.js').then((m) => ({
      default: m.EstateDepartmentAdvisorClient,
    })),
  {
    ssr: false,
    loading: () => (
      <AdvisorLoading label="Loading estate-department advisor…" />
    ),
  },
);

export const metadata = {
  title: 'Estate-department health — Borjie HQ',
};

export default function EstateDepartmentAdvisorPage() {
  return (
    <PortalShell
      title="Estate-department health"
      description="Portfolio + ops + staffing + vendor + risk + regulatory + owner-relations sections with the top-N veteran-director recommendations."
    >
      <EstateDepartmentAdvisorClient />
    </PortalShell>
  );
}
