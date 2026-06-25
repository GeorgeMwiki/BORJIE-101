import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { DataPrivacyClient } from './DataPrivacyClient';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'Data privacy', sw: 'Faragha ya data' },
  subtitle: {
    en: 'GDPR right-to-be-forgotten requests, intake and execution.',
    sw: 'Maombi ya haki-ya-kusahaulika ya GDPR, upokeaji na utekelezaji.',
  },
} as const;

export default async function DataPrivacyPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <DataPrivacyClient initialLocale={locale} />
    </PageShell>
  );
}
