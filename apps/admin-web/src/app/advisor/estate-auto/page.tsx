import dynamic from 'next/dynamic';
import { PortalShell } from '../_lib/PortalShell';
import { AdvisorLoading } from '../_lib/states';

const EstateAutoAdvisorClient = dynamic(
  () =>
    import('./EstateAutoAdvisorClient.js').then((m) => ({
      default: m.EstateAutoAdvisorClient,
    })),
  {
    ssr: false,
    loading: () => (
      <AdvisorLoading label="Loading estate-automation advisor…" />
    ),
  },
);

export const metadata = {
  title: 'Estate automation — Borjie HQ',
};

export default function EstateAutoAdvisorPage() {
  return (
    <PortalShell
      title="Estate automation"
      description="Predictive-maintenance dashboard (asset health × probability matrix) + collection cadence + vendor scorecard for the operating estate."
    >
      <EstateAutoAdvisorClient />
    </PortalShell>
  );
}
