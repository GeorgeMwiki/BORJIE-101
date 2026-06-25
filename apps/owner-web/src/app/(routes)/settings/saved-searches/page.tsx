/**
 * Saved searches settings page — Roadmap R2.
 *
 * Owner-defined alert rules. Each rule is one (label, queryJson,
 * frequency, source) tuple; the worker re-runs the query on the
 * frequency cadence and dispatches an owner-messaging alert when
 * new matches land.
 *
 * Server component resolves the active locale and renders the heading
 * in that ONE language; the client component drives the form + list
 * against /api/v1/owner/saved-searches.
 */

import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { settingsPagesStrings as S } from '@/i18n/strings/settings-pages';
import { SavedSearchesPanel } from './saved-searches-panel';

const P = S.savedSearchesPage;

export const dynamic = 'force-dynamic';

export default async function SavedSearchesPage() {
  const locale = await readLocaleFromServerCookies();

  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl text-foreground">
          {pickByLocale(locale, P.heading)}
        </h1>
        <p className="mt-0.5 text-xs italic text-muted-foreground">
          {pickByLocale(locale, P.tagline)}
        </p>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          {pickByLocale(locale, P.intro)}
        </p>
      </header>
      <SavedSearchesPanel initialLocale={locale} />
    </main>
  );
}
