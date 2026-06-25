import { ScreenHeader } from '@/components/ScreenHeader';
import { LicenceSurface } from '@/components/licence/LicenceSurface';
import { EmptyState } from '@/components/shared/EmptyState';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { licenceCockpitStrings as S } from '@/i18n/strings/licence-cockpit';

interface LicencePageProps {
  readonly searchParams: Promise<{ readonly id?: string }>;
}

/**
 * O-W-07 — Licence cockpit.
 *
 * Renewal-window countdown (T-90 / T-30 / T-7 cards), dormancy score
 * gauge with Mining Act 2010 citation, payment history table
 * (obligations vs payments), and "Generate renewal pack" button that
 * POSTs to /licences/:id/renew and pops a download toast.
 *
 * The licence to render is selected via the `?id=` query param (from the
 * licences list / deep links). When absent we render an honest prompt to
 * pick a licence rather than a hardcoded id.
 */
export default async function LicencePage({ searchParams }: LicencePageProps) {
  const { id } = await searchParams;
  const licenceId = id?.trim();
  const locale = await readLocaleFromServerCookies();
  return (
    <>
      <ScreenHeader slug="licence" />
      <div className="px-8 py-6">
        {licenceId ? (
          <LicenceSurface licenceId={licenceId} />
        ) : (
          <EmptyState
            title={pickByLocale(locale, S.page.noSelectionTitle)}
            description={pickByLocale(locale, S.page.noSelectionBody)}
          />
        )}
      </div>
    </>
  );
}
