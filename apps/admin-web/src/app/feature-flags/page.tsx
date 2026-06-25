import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { FeatureFlagsClient } from './FeatureFlagsClient';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'Feature flags', sw: 'Bendera za vipengele' },
  subtitle: {
    en: 'Resolved server-side flags for the calling staff scope.',
    sw: 'Bendera zilizotatuliwa upande wa seva kwa wigo wa wafanyakazi wanaoita.',
  },
} as const;

export default async function FeatureFlagsPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <FeatureFlagsClient initialLocale={locale} />
    </PageShell>
  );
}
