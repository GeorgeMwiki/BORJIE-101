import { ScreenHeader } from '@/components/ScreenHeader';
import { LicenceSurface } from '@/components/licence/LicenceSurface';

/**
 * O-W-07 — Licence cockpit.
 *
 * Renewal-window countdown (T-90 / T-30 / T-7 cards), dormancy score
 * gauge with Mining Act 2010 citation, payment history table
 * (obligations vs payments), and "Generate renewal pack" button that
 * POSTs to /licences/:id/renew and pops a download toast.
 */
export default function LicencePage() {
  return (
    <>
      <ScreenHeader slug="licence" />
      <div className="px-8 py-6">
        <LicenceSurface licenceId="lic_25434" />
      </div>
    </>
  );
}
