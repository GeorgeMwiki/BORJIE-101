import dynamic from 'next/dynamic';
import { PortalShell } from '../_lib/PortalShell';
import { AdvisorLoading } from '../_lib/states';

// `dynamic` defers the client bundle until the page actually renders.
// `ssr: false` keeps the heavy form (zod schemas, validators, react-hook-
// form) out of the server build so TTFB stays low. Cite: nextjs.org/docs/
// app/getting-started/partial-prerendering (Next.js 15+).
const AcquisitionAdvisorClient = dynamic(
  () =>
    import('./AcquisitionAdvisorClient.js').then((m) => ({
      default: m.AcquisitionAdvisorClient,
    })),
  {
    ssr: false,
    loading: () => <AdvisorLoading label="Loading acquisition advisor…" />,
  },
);

export const metadata = {
  title: 'Acquisition advisor — Borjie HQ',
};

export default function AcquisitionAdvisorPage() {
  return (
    <PortalShell
      title="Acquisition advisor"
      description="Triangulated pricing + DD findings + closing checklist for a deal under consideration. Composite verdict over financial, comps, environmental, title, survey, zoning, geotech, financial DD, and EA-jurisdictional axes."
    >
      <AcquisitionAdvisorClient />
    </PortalShell>
  );
}
