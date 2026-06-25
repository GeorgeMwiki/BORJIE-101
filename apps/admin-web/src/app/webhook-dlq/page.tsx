import { PageShell } from '@/components/migrated/PageShell';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { WebhookDLQClient } from './WebhookDLQClient';

// Header copy resolved server-side from the locale cookie so SSR and the
// client's first paint render the same language (zero-mix canon).
const HEADER = {
  title: { en: 'Webhook DLQ', sw: 'Foleni ya barua-zilizofeli za Webhook' },
  subtitle: {
    en: 'Outbound webhook dead-letter queue — inspect and replay failed deliveries.',
    sw: 'Foleni ya barua-zilizofeli za webhook za kutoka — kagua na rejesha utumaji uliofeli.',
  },
} as const;

export default async function WebhookDLQPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <PageShell
      title={pickByLocale(locale, HEADER.title)}
      subtitle={pickByLocale(locale, HEADER.subtitle)}
    >
      <WebhookDLQClient initialLocale={locale} />
    </PageShell>
  );
}
