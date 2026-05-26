import { ScreenHeader } from '@/components/ScreenHeader';
import { LicencesList } from '@/components/licences/LicencesList';

/**
 * Licences index. Companion to the existing `/licence/[id]` cockpit;
 * lists every licence under the active tenant and links into each
 * row's cockpit.
 *
 * Live endpoint: GET /api/v1/mining/licences.
 */
export default function LicencesIndexPage() {
  return (
    <>
      <ScreenHeader slug="licences" />
      <div className="px-8 py-6">
        <LicencesList />
      </div>
    </>
  );
}
