import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { IntegrationsClient } from './IntegrationsClient';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'API integrations', sw: 'Uunganishaji wa API' },
  subtitle: {
    en: 'Agent certifications gating external access to the platform API.',
    sw: 'Vyeti vya wakala vinavyodhibiti ufikiaji wa nje wa API ya jukwaa.',
  },
} as const;

export default async function IntegrationsPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <IntegrationsClient initialLocale={locale} />
    </PageShell>
  );
}
