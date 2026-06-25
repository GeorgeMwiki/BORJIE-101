import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import {
  SCREEN_GROUPS,
  screensByGroup,
  internalHref,
  INTERNAL_SCREENS,
} from '@/lib/internal/screens';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';

/**
 * Borjie Console landing — grid of all internal admin screens grouped by
 * Tenants / Intelligence / Quality / Ops per the build plan and
 * UI_SCREEN_CATALOGUE.md §D. Server component: resolves the active locale
 * from the cookie and renders ONE language (zero-mix canon).
 *
 * Protection copy states what is ACTUALLY enforced — an operator-only
 * session gate (`src/middleware.ts` + an api-gateway re-check). SSO and
 * IP allow-listing are NOT wired anywhere in admin-web (no SAML/OIDC, no
 * IP gate), so advertising them here was a false security claim (D26
 * honesty); it was removed, matching the Sidebar footer fix.
 */
export default async function ConsoleHomePage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  const screenCount = INTERNAL_SCREENS.length;
  return (
    <main id="main-content" className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-10">
        <p className="text-caption uppercase tracking-widest text-signal-500 mb-2">
          {pickByLocale(locale, {
            en: 'Internal admin · Section D',
            sw: 'Usimamizi wa ndani · Sehemu D',
          })}
        </p>
        <h1 className="text-4xl font-display text-foreground mb-3">
          Borjie Console
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {pickByLocale(locale, {
            en: 'Operational surfaces that run the Borjie platform: from tenant onboarding through corpus management, prompt promotion, compliance review, and the emergency killswitch. Operator-only and session-gated; every mutation lands in the append-only audit log.',
            sw: 'Nyuso za uendeshaji zinazoendesha jukwaa la Borjie: kuanzia usajili wa wateja, usimamizi wa korpasi, kupandisha prompt, ukaguzi wa uzingatiaji, hadi kitufe cha dharura cha kuzima. Waendeshaji pekee na kikao kimethibitishwa; kila mabadiliko huingia kwenye kumbukumbu ya ukaguzi isiyobadilika.',
          })}
        </p>
        <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            {pickByLocale(locale, {
              en: `${screenCount} screens`,
              sw: `skrini ${screenCount}`,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {pickByLocale(locale, {
              en: `${SCREEN_GROUPS.length} groups`,
              sw: `makundi ${SCREEN_GROUPS.length}`,
            })}
          </span>
          <span aria-hidden="true">·</span>
          <Link href="/" className="hover:text-foreground transition-colors underline underline-offset-4">
            {pickByLocale(locale, {
              en: 'Back to Platform HQ',
              sw: 'Rudi kwenye Makao Makuu',
            })}
          </Link>
        </div>
      </header>

      <div className="space-y-10">
        {SCREEN_GROUPS.map((group) => {
          const screens = screensByGroup(group.id);
          return (
            <section key={group.id} aria-labelledby={`group-${group.id}`}>
              <div className="flex items-baseline justify-between mb-4">
                <div>
                  <h2
                    id={`group-${group.id}`}
                    className="text-xl font-display text-foreground"
                  >
                    {pickByLocale(locale, group.labelI18n)}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {pickByLocale(locale, group.blurbI18n)}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {pickByLocale(locale, {
                    en: `${screens.length} screens`,
                    sw: `skrini ${screens.length}`,
                  })}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {screens.map((screen) => (
                  <Link
                    key={screen.id}
                    href={internalHref(screen.slug)}
                    className="platform-card hover:border-signal-500/40 transition-colors group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-caption uppercase tracking-widest text-signal-500">
                        {screen.id}
                      </span>
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-signal-500 transition-colors" />
                    </div>
                    <h3 className="text-base font-display text-foreground mb-1">
                      {pickByLocale(locale, screen.titleI18n)}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {pickByLocale(locale, screen.intentI18n)}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
