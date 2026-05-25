import dynamic from 'next/dynamic';
import { PortalShell } from '../_lib/PortalShell';
import { AdvisorLoading } from '../_lib/states';

// Geo advisor is the heaviest of the eight — pulls in MapLibre/Leaflet
// via ParcelMap.tsx. Dynamic + ssr:false keeps map deps out of the
// server build entirely. The map is useless server-side anyway.
const GeoAdvisorClient = dynamic(
  () =>
    import('./GeoAdvisorClient.js').then((m) => ({
      default: m.GeoAdvisorClient,
    })),
  {
    ssr: false,
    loading: () => <AdvisorLoading label="Loading map + advisor panel…" />,
  },
);

export const metadata = {
  title: 'Geo advisor — Borjie HQ',
};

export default function GeoAdvisorPage() {
  return (
    <PortalShell
      title="Geo advisor"
      description="Live parcel map with painted parcels + an area-insights side panel covering solar potential, air quality, and drive-time."
    >
      <GeoAdvisorClient />
    </PortalShell>
  );
}
