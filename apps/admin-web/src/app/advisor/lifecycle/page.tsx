import dynamic from 'next/dynamic';
import { PortalShell } from '../_lib/PortalShell';
import { AdvisorLoading } from '../_lib/states';

const LifecycleAdvisorClient = dynamic(
  () =>
    import('./LifecycleAdvisorClient.js').then((m) => ({
      default: m.LifecycleAdvisorClient,
    })),
  {
    ssr: false,
    loading: () => <AdvisorLoading label="Loading lifecycle advisor…" />,
  },
);

export const metadata = {
  title: 'Lifecycle advisor — Borjie HQ',
};

export default function LifecycleAdvisorPage() {
  return (
    <PortalShell
      title="Lifecycle advisor"
      description="Pick an asset + lifecycle stage and the advisor returns the next-best action ranked by priority and confidence, with citations and alternatives."
    >
      <LifecycleAdvisorClient />
    </PortalShell>
  );
}
