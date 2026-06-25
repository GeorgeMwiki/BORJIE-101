/**
 * Mr. Mwikila "Acting on your behalf" inbox — owner-web page.
 *
 * Server component renders the locale-pure heading; the client component
 * drives the list + one-tap approve / deny / reverse.
 *
 * Routes used:
 *   GET    /api/v1/owner/mwikila-inbox
 *   POST   /api/v1/owner/mwikila-inbox/:id/approve
 *   POST   /api/v1/owner/mwikila-inbox/:id/deny
 *   POST   /api/v1/owner/mwikila-inbox/:id/reverse
 */

import { MwikilaInboxPanel } from './mwikila-inbox-panel';
import { pickByLocale } from '@/lib/locale-shared';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

export const dynamic = 'force-dynamic';

export default async function MwikilaInboxPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl text-foreground">
          {pickByLocale(locale, S.inboxPage.heading)}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          {pickByLocale(locale, S.inboxPage.body)}
        </p>
      </header>
      <MwikilaInboxPanel initialLocale={locale} />
    </main>
  );
}
