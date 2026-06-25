import type { Metadata } from 'next';
import { JurisdictionSettings } from './jurisdiction-settings';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { settingsPagesStrings as S } from '@/i18n/strings/settings-pages';

const P = S.jurisdictionPage;

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await readLocaleFromServerCookies();
  return {
    title: pickByLocale(locale, P.metaTitle),
  };
}

/**
 * /settings/jurisdiction — JA-7.
 *
 * Owner-visible jurisdiction settings page. Surfaces:
 *   - tenant's current country, named regulators, currency,
 *     default language, time zone (live from /api/v1/me/jurisdiction)
 *   - LOCKED state notice — tenant.jurisdiction is locked at
 *     signup per migration 0149; permanent change goes through
 *     Borjie support (JC-7 four-eye admin path)
 *   - "Ask Mr. Mwikila about another jurisdiction for this
 *     conversation" CTA — points the owner at the brain's
 *     per-turn override (JC-6 mwikila.jurisdiction.switch)
 */
export default async function JurisdictionSettingsPage() {
  const locale = await readLocaleFromServerCookies();

  return (
    <>
      <header className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            O-W-22.JURISDICTION
          </span>
          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-badge text-muted-foreground">
            {pickByLocale(locale, P.ownerBadge)}
          </span>
        </div>
        <h1 className="mt-1 font-display text-3xl text-foreground">
          {pickByLocale(locale, P.heading)}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          {pickByLocale(locale, P.intro)}
        </p>
      </header>
      <div className="px-8 py-6">
        <JurisdictionSettings initialLocale={locale} />
      </div>
    </>
  );
}
