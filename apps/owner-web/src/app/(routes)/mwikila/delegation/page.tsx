/**
 * Mr. Mwikila delegation matrix — owner-web page.
 *
 * The 12 × 4 matrix where the owner sets the per-category autonomy
 * tier (T0 inform / T1 propose / T2 act-with-reversal / T3
 * irrevocable).
 *
 * Routes used:
 *   GET   /api/v1/owner/delegation
 *   PATCH /api/v1/owner/delegation
 */

import { DelegationMatrix } from './delegation-matrix';
import { pickByLocale } from '@/lib/locale-shared';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';

export const dynamic = 'force-dynamic';

export default async function MwikilaDelegationPage() {
  const locale = await readLocaleFromServerCookies();
  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl text-foreground">
          {pickByLocale(locale, S.delegationPage.heading)}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          {pickByLocale(locale, S.delegationPage.body)}
        </p>
      </header>
      <DelegationMatrix initialLocale={locale} />
    </main>
  );
}
