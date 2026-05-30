import type { Metadata } from 'next';
import { LegalShell, type LegalSection } from '@/components/LegalShell';
import { getLocale } from '@/lib/locale';

/**
 * /legal/cookies , cookie table per LitFin marketing secondary spec §7.
 */

export const metadata: Metadata = {
  title: 'Cookie Policy , Borjie',
  description:
    'Borjie cookie policy. Strictly necessary cookies, analytics opt-in, lifetimes documented per category.',
};

interface CookieRow {
  readonly cookie: string;
  readonly purposeEn: string;
  readonly purposeSw: string;
  readonly category: 'strictly-necessary' | 'preference' | 'analytics';
  readonly lifetime: string;
}

const COOKIES: ReadonlyArray<CookieRow> = [
  {
    cookie: 'borjie_session',
    purposeEn: 'Maintains the authenticated owner / buyer session',
    purposeSw: 'Inahifadhi kikao cha mmiliki au mnunuzi aliyethibitishwa',
    category: 'strictly-necessary',
    lifetime: '24h',
  },
  {
    cookie: 'borjie_csrf',
    purposeEn: 'Prevents cross-site request forgery on form submission',
    purposeSw: 'Inazuia ulaghai wa cross-site kwenye fomu',
    category: 'strictly-necessary',
    lifetime: 'session',
  },
  {
    cookie: 'borjie_locale',
    purposeEn: 'Stores the chosen interface language (sw or en)',
    purposeSw: 'Inahifadhi lugha iliyochaguliwa (sw au en)',
    category: 'preference',
    lifetime: '1 year',
  },
  {
    cookie: 'borjie_consent',
    purposeEn: 'Records the cookie banner choice',
    purposeSw: 'Inahifadhi chaguo la beneri ya cookies',
    category: 'preference',
    lifetime: '6 months',
  },
  {
    cookie: 'borjie_analytics',
    purposeEn: 'Anonymised page-view counter (opt-in only)',
    purposeSw: 'Hesabu ya kutembelea ukurasa bila kitambulisho (kwa idhini tu)',
    category: 'analytics',
    lifetime: '90 days',
  },
];

const CATEGORY_LABEL: Readonly<
  Record<CookieRow['category'], { readonly en: string; readonly sw: string }>
> = {
  'strictly-necessary': {
    en: 'Strictly necessary',
    sw: 'Lazima kabisa',
  },
  preference: { en: 'Preference', sw: 'Mapendekezo' },
  analytics: { en: 'Analytics (opt-in)', sw: 'Uchambuzi (kwa idhini)' },
};

function buildSections(locale: 'sw' | 'en'): ReadonlyArray<LegalSection> {
  const isSw = locale === 'sw';
  return [
    {
      id: 'overview',
      title: isSw ? '1. Maelezo' : '1. Overview',
      body: isSw
        ? 'Tunatumia cookies kwa lazima na kwa mapendekezo. Cookies za uchambuzi ni za hiari kabisa.'
        : 'We use cookies in three categories: strictly necessary, preference, and (opt-in) analytics. Nothing tracks you without consent.',
    },
    {
      id: 'list',
      title: isSw ? '2. Orodha ya cookies' : '2. Cookie list',
      body: (
        <div className="-mx-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border/60 text-tiny uppercase tracking-widest text-foreground/60">
              <tr>
                <th className="px-3 py-2 font-semibold">Cookie</th>
                <th className="px-3 py-2 font-semibold">
                  {locale === 'sw' ? 'Madhumuni' : 'Purpose'}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {locale === 'sw' ? 'Kategoria' : 'Category'}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {locale === 'sw' ? 'Muda' : 'Lifetime'}
                </th>
              </tr>
            </thead>
            <tbody>
              {COOKIES.map((c) => (
                <tr
                  key={c.cookie}
                  className="border-b border-border/30 align-top"
                >
                  <td className="px-3 py-2 font-mono text-tiny text-foreground">
                    {c.cookie}
                  </td>
                  <td className="px-3 py-2 text-foreground/70">
                    {locale === 'sw' ? c.purposeSw : c.purposeEn}
                  </td>
                  <td className="px-3 py-2 text-foreground/70">
                    {CATEGORY_LABEL[c.category][locale]}
                  </td>
                  <td className="px-3 py-2 font-mono text-tiny text-foreground/70">
                    {c.lifetime}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      id: 'consent',
      title: isSw ? '3. Kubadilisha idhini' : '3. Change consent',
      body: isSw
        ? 'Bonyeza kitufe cha "Settings" kwenye beneri ya cookies kufunua tena chaguzi zako. Cookies za uchambuzi zinaweza kuzimwa wakati wowote.'
        : 'Press the "Settings" button on the cookie banner to reopen your choices. Analytics cookies can be turned off at any time.',
    },
  ];
}

export default async function LegalCookiesPage() {
  const locale = await getLocale();
  const isSw = locale === 'sw';
  return (
    <LegalShell
      locale={locale}
      kicker={isSw ? 'Cookies' : 'Cookies'}
      heading={isSw ? 'Sera ya Cookies' : 'Cookie Policy'}
      lastUpdated={isSw ? 'Imesasishwa 28 Mei 2026' : 'Last updated 28 May 2026'}
      sections={buildSections(locale)}
    />
  );
}
