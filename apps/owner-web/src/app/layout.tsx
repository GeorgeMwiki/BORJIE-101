import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { OwnerShell } from '@/components/OwnerShell';
import { AppProviders } from './providers';
import { BorjieWidgetMount } from '@/components/BorjieWidgetMount';
import { OwnerCommandPalette } from '@/components/OwnerCommandPalette';
import { WebVitalsReporter } from '@/components/perf/WebVitalsReporter';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { FeedbackButton } from '@/components/FeedbackButton';
import { ThemeProvider, BORJIE_THEME_BOOTSTRAP_SCRIPT } from '@borjie/design-system';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';
import { LocaleProvider } from '@/lib/locale-context';

export const metadata: Metadata = {
  title: 'Borjie — Owner Cockpit',
  description:
    'Strategic cockpit for Tanzanian mining owners. Master Brain, LMBM, cockpit dashboards, treasury, compliance — Swahili-first.',
  applicationName: 'Borjie Owner Cockpit',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'Borjie — Owner Cockpit',
    description:
      'Strategic cockpit for Tanzanian mining owners. Master Brain, LMBM, treasury, compliance.',
    siteName: 'Borjie',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Borjie' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#17100A',
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Single source of truth for the active language — the `borjie_locale`
  // cookie (default 'en'). The layout chrome, command palette, session,
  // and every downstream surface all read from this so the cockpit never
  // mixes EN and SW on one page.
  const locale = await readLocaleFromServerCookies();
  // Public/auth routes (the sign-in form) must render OUTSIDE the
  // session-gated `OwnerShell` — the shell resolves the owner session and
  // `redirect('/sign-in')`s when unauthenticated, so wrapping `/sign-in`
  // itself in it is an infinite redirect loop. The middleware forwards the
  // active pathname as `x-borjie-pathname` so this server layout can branch.
  const pathname = (await headers()).get('x-borjie-pathname') ?? '';
  const isAuthRoute = pathname === '/sign-in' || pathname.startsWith('/sign-in/');
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Inline FOUC defeat — read borjie-theme localStorage and stamp
            the correct class on <html> before React hydrates. */}
        <script
          dangerouslySetInnerHTML={{ __html: BORJIE_THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="bg-background text-foreground antialiased min-h-screen">
        <a href="#main-content" className="skip-link">
          {pickByLocale(locale, {
            en: 'Skip to main content',
            sw: 'Ruka hadi maudhui makuu',
          })}
        </a>
        <ThemeProvider defaultTheme="light" enableSystem>
          <LocaleProvider value={locale}>
          <AppProviders>
            {isAuthRoute ? (
              // Sign-in: bare page, NO session-gated shell/chrome (would loop).
              children
            ) : (
              <>
            <OwnerShell>{children}</OwnerShell>
            <BorjieWidgetMount />
            {/* Wave SUPERPOWERS - universal Cmd-K palette. Mounted at
                the root so it works on every owner screen. Language
                follows the resolved `borjie_locale` (default 'en') — the
                same source the layout chrome and dashboard read. */}
            <OwnerCommandPalette languagePreference={locale} />
              </>
            )}
            {/* SOTA lazy-load Wave — Web Vitals side-channel reporter.
                Lazy-loads web-vitals v5 on the client, ships LCP/INP/CLS/
                TTFB/FCP via sendBeacon to /api/perf/web-vitals. Pure side
                channel — never blocks render, never gates a fetch. */}
            <WebVitalsReporter surface="owner-web" />
            {/* PWA — register the cache-first SW after hydration. Silent;
                skipped in dev. See `public/sw.js` and `public/offline.html`. */}
            <ServiceWorkerRegister />
            {/* Pilot feedback widget — fixed bottom-right pill. Opt-in
                mount via `FEEDBACK_BUTTON_DISABLE` env to silence in
                screenshot / load test runs. Language follows the resolved
                `borjie_locale` (default 'en') — same source as the chrome
                so the pill never leaks the inactive language. */}
            <FeedbackButton lang={locale} />
          </AppProviders>
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
