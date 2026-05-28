import type { Metadata, Viewport } from 'next';
import './globals.css';
import { OwnerShell } from '@/components/OwnerShell';
import { AppProviders } from './providers';
import { BorjieWidgetMount } from '@/components/BorjieWidgetMount';
import { OwnerCommandPalette } from '@/components/OwnerCommandPalette';
import { WebVitalsReporter } from '@/components/perf/WebVitalsReporter';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ThemeProvider, BORJIE_THEME_BOOTSTRAP_SCRIPT } from '@borjie/design-system';

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
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Inline FOUC defeat — read borjie-theme localStorage and stamp
            the correct class on <html> before React hydrates. */}
        <script
          dangerouslySetInnerHTML={{ __html: BORJIE_THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="bg-background text-foreground antialiased min-h-screen">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ThemeProvider defaultTheme="dark" enableSystem>
          <AppProviders>
            <OwnerShell>{children}</OwnerShell>
            <BorjieWidgetMount />
            {/* Wave SUPERPOWERS - universal Cmd-K palette. Mounted at
                the root so it works on every owner screen. The owner's
                language preference is read from the persisted preference
                stored in localStorage; falls back to English. */}
            <OwnerCommandPalette languagePreference="en" />
            {/* SOTA lazy-load Wave — Web Vitals side-channel reporter.
                Lazy-loads web-vitals v5 on the client, ships LCP/INP/CLS/
                TTFB/FCP via sendBeacon to /api/perf/web-vitals. Pure side
                channel — never blocks render, never gates a fetch. */}
            <WebVitalsReporter surface="owner-web" />
            {/* PWA — register the cache-first SW after hydration. Silent;
                skipped in dev. See `public/sw.js` and `public/offline.html`. */}
            <ServiceWorkerRegister />
          </AppProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
