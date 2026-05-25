import dynamic from 'next/dynamic';
import { PortalShell } from '../_lib/PortalShell';
import { AdvisorLoading } from '../_lib/states';

const ExpansionAdvisorClient = dynamic(
  () =>
    import('./ExpansionAdvisorClient.js').then((m) => ({
      default: m.ExpansionAdvisorClient,
    })),
  {
    ssr: false,
    loading: () => <AdvisorLoading label="Loading expansion advisor…" />,
  },
);

export const metadata = {
  title: 'Expansion advisor — Borjie HQ',
};

export default function ExpansionAdvisorPage() {
  return (
    <PortalShell
      title="Expansion advisor"
      description="HBU 4-test gate log, capital-stack visualisation, and lease-up + absorption curves for a candidate expansion parcel."
    >
      <ExpansionAdvisorClient />
    </PortalShell>
  );
}
