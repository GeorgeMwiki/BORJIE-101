import dynamic from 'next/dynamic';
import { PortalShell } from '../_lib/PortalShell';
import { AdvisorLoading } from '../_lib/states';

const GreenAngleAdvisorClient = dynamic(
  () =>
    import('./GreenAngleAdvisorClient.js').then((m) => ({
      default: m.GreenAngleAdvisorClient,
    })),
  {
    ssr: false,
    loading: () => <AdvisorLoading label="Loading green-angle advisor…" />,
  },
);

export const metadata = {
  title: 'Green-angle advisor — Borjie HQ',
};

export default function GreenAngleAdvisorPage() {
  return (
    <PortalShell
      title="Green-angle advisor"
      description="Free-text project description → ranked green opportunities + financing instrument matches + carbon-credit methodologies + SDG alignment radar."
    >
      <GreenAngleAdvisorClient />
    </PortalShell>
  );
}
