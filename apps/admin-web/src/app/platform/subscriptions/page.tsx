import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { SubscriptionsClient } from './SubscriptionsClient';

// Header copy is resolved on the SERVER from the same cookie that seeds the
// client locale, so SSR and the client's first paint render the SAME language
// (zero-mix canon — no EN header over an SW body for a frame). `pickByLocale`
// is hook-free, so it is safe to call from this server component.
const HEADER = {
  title: { en: 'Subscriptions', sw: 'Michango' },
  subtitle: {
    en: 'Every active subscription across the platform — status, MRR, billing cycle.',
    sw: 'Kila mchango unaoendelea kwenye jukwaa — hali, MRR, mzunguko wa ankara.',
  },
} as const;

export default async function PlatformSubscriptionsPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <SubscriptionsClient initialLocale={locale} />
    </PageShell>
  );
}
