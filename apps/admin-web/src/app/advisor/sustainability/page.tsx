import dynamic from 'next/dynamic';
import { PortalShell } from '../_lib/PortalShell';
import { AdvisorLoading } from '../_lib/states';

const SustainabilityAdvisorClient = dynamic(
  () =>
    import('./SustainabilityAdvisorClient.js').then((m) => ({
      default: m.SustainabilityAdvisorClient,
    })),
  {
    ssr: false,
    loading: () => <AdvisorLoading label="Loading sustainability advisor…" />,
  },
);

export const metadata = {
  title: 'Sustainability advisor — Borjie HQ',
};

export default function SustainabilityAdvisorPage() {
  return (
    <PortalShell
      title="Sustainability advisor"
      description="GHG Protocol Scope 1/2/3, BREEAM/LEED/EDGE predicted rating, BNG units, and forecast carbon-credit value for a selected property."
    >
      <SustainabilityAdvisorClient />
    </PortalShell>
  );
}
