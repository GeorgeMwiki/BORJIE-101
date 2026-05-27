import type { Metadata, Viewport } from 'next';
import { Inter, Syne } from 'next/font/google';
import './globals.css';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { CookieConsent } from '@/components/CookieConsent';
import { BorjieWidgetMount } from '@/components/BorjieWidgetMount';

// Typography stack — LitFin parity:
//   - Display: Syne (geometric sans, distinctive weight curve)
//   - Sans:    Inter (variable, optical-size aware)
// Both shipped from next/font/google with subset-latin only so the
// initial CSS payload stays small. Variable forms keep paint sharp
// without preloading multiple weight files.
const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans-override',
  display: 'swap',
});

const fontDisplay = Syne({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display-override',
  display: 'swap',
});
import { ScrollProgressBar } from '@/components/animations/ScrollProgressBar';
// WebVitalsReporter pulls @borjie/performance-toolkit which uses a
// Vite-only dynamic import comment that breaks both Turbopack and
// webpack's watcher (EMFILE). Disabled in dev — the production build
// re-enables via NEXT_PUBLIC_ENABLE_WEB_VITALS=1.
// import { WebVitalsReporter } from '@/components/perf/WebVitalsReporter';

/**
 * Resolve the canonical marketing site origin. Preview deploys override
 * via `NEXT_PUBLIC_MARKETING_SITE_URL`; production builds must set it
 * (we keep a literal dev fallback only for `next dev`).
 */
function resolveSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_MARKETING_SITE_URL must be set in production marketing builds.',
    );
  }
  return 'https://borjie.co.tz';
}

const SITE_URL = resolveSiteUrl();

export const metadata: Metadata = {
  title: 'Borjie — AI-native operating system for Tanzanian mining',
  description:
    'Borjie is the AI-native operating system for Tanzanian mining. Master Brain, licence calendar, drill-hole logger, FX & treasury, marketplace, compliance pack. Swahili-first. Multi-tenant. Multi-lingual.',
  applicationName: 'Borjie',
  metadataBase: new URL(SITE_URL),
  // UNIV-4: TZ-launch-beachhead marketing keywords — defer to vertical-profile/jurisdiction-profile marketing manifest when expanding to KE/NG/ZA/etc; tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
  keywords: [
    'Tanzania mining software',
    'AI-native mining OS',
    'PML licence management',
    'gold-window treasury',
    'mining compliance Tanzania',
    'Tumemadini',
    'NEMC',
    'Master Brain',
    'Borjie',
    'mining marketplace Tanzania',
  ],
  openGraph: {
    title: 'Borjie — AI-native operating system for Tanzanian mining',
    description:
      'Run your mine like the world\'s best. Master Brain, licence calendar, FX & treasury, marketplace, compliance pack. Swahili-first.',
    type: 'website',
    siteName: 'Borjie',
    locale: 'sw_TZ',
    alternateLocale: ['en_US'],
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Borjie — AI-native OS for Tanzanian mining',
    description:
      'Run your mine like the world\'s best. Master Brain, licence calendar, FX & treasury, marketplace, compliance pack.',
    creator: '@borjie_tz',
  },
  alternates: {
    canonical: SITE_URL,
    languages: {
      sw: SITE_URL,
      en: `${SITE_URL}?lang=en`,
    },
  },
  robots: {
    index: true,
    follow: true,
  },
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#17100A',
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
};

export default async function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = getMessages(locale).common;
  return (
    <html lang={locale} className={`dark ${fontSans.variable} ${fontDisplay.variable}`}>
      <body className="bg-background text-foreground antialiased min-h-screen font-sans">
        <ScrollProgressBar />
        <a href="#main-content" className="skip-link">
          {t.skipToContent}
        </a>
        {children}
        <CookieConsent locale={locale} />
        <BorjieWidgetMount locale={locale} />
        {/* SOTA lazy-load Wave — Web Vitals side-channel reporter.
            Disabled in dev — see import block above. */}
        {/* <WebVitalsReporter surface="marketing" /> */}
      </body>
    </html>
  );
}
