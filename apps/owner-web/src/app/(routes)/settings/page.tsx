import Link from 'next/link';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PlanBillingPanel } from '@/components/settings/PlanBillingPanel';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { NotificationPreferencesPanel } from '@/components/settings/NotificationPreferencesPanel';
import { settingsPageStrings as S } from '@/i18n/strings/settings-page';

/**
 * O-W-22 — Settings. Plan + billing is wired to the live current-tenant
 * read (GET /api/v1/tenants/current via PlanBillingPanel). NOTE: the
 * cockpit does NOT call `/mining/internal/tenants/me` — that surface is
 * SUPER_ADMIN-only and not owner-callable.
 *
 * JA-7 — adds a Jurisdiction sub-page link so the owner can inspect
 * the country / regulators / currency / language / time zone that
 * drive every royalty draft and licence reminder.
 *
 * owner-settings-3 / owner-settings-8 — adds the NotificationPreferences
 * surface (PUT /api/v1/owner/contact-prefs) and fixes all locale violations
 * so EN users never see Swahili subtitles (and vice versa).
 */
export default async function SettingsPage() {
  const locale = await readLocaleFromServerCookies();

  return (
    <>
      <ScreenHeader slug="settings" />
      <div className="px-8 py-6 space-y-6">
        <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/settings/jurisdiction"
            className="group rounded-md border border-border bg-surface p-5 transition hover:border-foreground/30"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg text-foreground">
                {pickByLocale(locale, S.jurisdictionTitle)}
              </h2>
              <span className="text-xs text-neutral-400 group-hover:text-foreground">
                →
              </span>
            </div>
            <p className="mt-0.5 text-xs italic text-neutral-500">
              {pickByLocale(locale, S.jurisdictionSubtitle)}
            </p>
          </Link>
          <Link
            href="/settings/connected-agents"
            className="group rounded-md border border-border bg-surface p-5 transition hover:border-foreground/30"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg text-foreground">
                {pickByLocale(locale, S.connectedAgentsTitle)}
              </h2>
              <span className="text-xs text-neutral-400 group-hover:text-foreground">
                →
              </span>
            </div>
            <p className="mt-0.5 text-xs italic text-neutral-500">
              {pickByLocale(locale, S.connectedAgentsSubtitle)}
            </p>
          </Link>
        </nav>
        <NotificationPreferencesPanel />
        <PlanBillingPanel />
      </div>
    </>
  );
}
