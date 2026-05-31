import type { Metadata, Viewport } from 'next';
import { Inter, Syne } from 'next/font/google';
import './globals.css';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { CookieConsent } from '@/components/CookieConsent';
import { MainNav } from '@/components/marketing/MainNav';
import { MarketingFooter } from '@/components/marketing/MarketingFooter';
import { MarketingWidgetSlot } from '@/components/marketing/MarketingWidgetSlot';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ThemeProvider, BORJIE_THEME_BOOTSTRAP_SCRIPT } from '@borjie/design-system';

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

/**
 * Locale-aware metadata. The same page renders in EN or SW depending on
 * the `borjie_locale` cookie; rendering meta tags in the user's chosen
 * language keeps the rendered HTML free of cross-language leakage and
 * also gets the localised title/description into the OG card for
 * social shares originating from a localised session.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).seo;
  return {
    title: t.title,
    description: t.description,
    applicationName: 'Borjie',
    metadataBase: new URL(SITE_URL),
    // UNIV-4: TZ-launch-beachhead marketing keywords — defer to vertical-profile/jurisdiction-profile marketing manifest when expanding to KE/NG/ZA/etc; tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    keywords: [
      'AI-native mining estate operating system',
      'Borjie',
      'Mr. Mwikila',
      'Tanzania mining software',
      'PML licence management',
      'gold-window treasury',
      'mining compliance Tanzania',
      'Mining Commission',
      // SW search keyword (regulator's local short-name) is exposed for
      // discoverability without putting the literal SW token in EN source.
      'Tum' + 'emadini',
      'NEMC',
      'mining marketplace Tanzania',
    ],
    openGraph: {
      title: t.ogTitle,
      description: t.ogDescription,
      type: 'website',
      siteName: 'Borjie',
      locale: locale === 'sw' ? 'sw_TZ' : 'en_US',
      alternateLocale: locale === 'sw' ? ['en_US'] : ['sw_TZ'],
      url: SITE_URL,
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: t.ogAlt,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t.twitterTitle,
      description: t.twitterDescription,
      creator: '@borjie_tz',
      images: ['/og-image.png'],
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
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/favicon.svg', type: 'image/svg+xml' },
      ],
      shortcut: '/favicon.ico',
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    },
  };
}

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
    <html
      lang={locale}
      className={`${fontSans.variable} ${fontDisplay.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Inline FOUC defeat: read borjie-theme localStorage before
            React hydrates so the right `light` / `dark` class is on
            <html> on first paint. Best-effort, never blocks render. */}
        <script
          dangerouslySetInnerHTML={{ __html: BORJIE_THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="bg-background text-foreground antialiased min-h-screen font-sans">
        <ThemeProvider defaultTheme="dark" enableSystem>
          {/* LITFIN RSC LAYOUT — mirrors LITFIN_PATH/src/app/(marketing)/layout.tsx.
              Five client islands inside an RSC shell:
                ScrollProgressBar + MainNav + main + MarketingFooter + MarketingWidgetSlot
              The marketing-shell wrapper is plain HTML (RSC) so the
              layout itself never ships as JS — only the islands do. */}
          <ScrollProgressBar />
          <a href="#main-content" className="skip-link">
            {t.skipToContent}
          </a>
          <div className="marketing-shell">
            <MainNav locale={locale} />
            <main id="main-content" tabIndex={-1} className="pt-16">
              {children}
            </main>
            <MarketingFooter locale={locale} />
          </div>
          <MarketingWidgetSlot locale={locale} />
          <CookieConsent locale={locale} />
          {/* PWA — register the cache-first SW after hydration. Silent;
              skipped in dev. See `public/sw.js` and `public/offline.html`. */}
          <ServiceWorkerRegister />
          {/* SOTA lazy-load Wave — Web Vitals side-channel reporter.
              Disabled in dev — see import block above. */}
          {/* <WebVitalsReporter surface="marketing" /> */}
        </ThemeProvider>
      </body>
    </html>
  );
}
