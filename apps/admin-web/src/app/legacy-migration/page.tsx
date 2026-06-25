import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { LegacyMigrationClient } from './LegacyMigrationClient';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'Legacy LPMS migration', sw: 'Uhamisho wa LPMS ya zamani' },
  subtitle: {
    en: 'Import data from a legacy LPMS export (CSV / JSON / XML) — preview before commit.',
    sw: 'Leta data kutoka kwa hamishaji ya LPMS ya zamani (CSV / JSON / XML) — hakiki kabla ya kuthibitisha.',
  },
} as const;

export default async function LegacyMigrationPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <LegacyMigrationClient initialLocale={locale} />
    </PageShell>
  );
}
