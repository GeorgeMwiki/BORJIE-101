import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SensoriumProvider } from '@/lib/sensorium/SensoriumProvider';
import { SessionReplayProvider } from '@/components/SessionReplayProvider';
import { BorjieWidgetMount } from '@/components/BorjieWidgetMount';
import { AdminCommandPalette } from '@/components/AdminCommandPalette';
import { WebVitalsReporter } from '@/components/perf/WebVitalsReporter';
import { AdminShell } from '@/components/AdminShell';
import { AdminShellGate } from '@/components/admin-shell/AdminShellGate';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ThemeProvider, BORJIE_THEME_BOOTSTRAP_SCRIPT } from '@borjie/design-system';

export const metadata: Metadata = {
  title: {
    default: 'Borjie Console — Internal Admin',
    template: '%s — Borjie Console',
  },
  description:
    'Borjie Console — internal admin surfaces for tenants, intelligence corpus, prompt and model registry, compliance review, audit logs, and platform killswitch.',
  applicationName: 'Borjie Console',
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
    title: 'Borjie Console — Internal Admin',
    description: 'Borjie Console — internal admin surfaces.',
    siteName: 'Borjie Console',
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
          {/* Central Command Phase A — C4 Sensorium / Brain Skin.
              Wires the 14-event sensory bus to every page in the portal so
              the brain (Mr. Mwikila) senses what the operator is doing in
              real time. Side-channel only — never blocks render. */}
          {/* Central Command Phase B — B5 Session Replay (rrweb cold store).
              Held SEPARATELY from the sensorium taxonomy: mouse-move replay
              at ≈20Hz lives here; it is NEVER fed into the LLM context. */}
          <SessionReplayProvider surface="admin-web">
            <SensoriumProvider surface="admin-web">
              {/* LitFin admin-portal parity — wrap every authenticated
                  route in the AdminShell (left rail + sticky top bar +
                  wide content frame). Auth + error routes opt out via
                  AdminShellGate so they render bare. */}
              <AdminShellGate
                bare={children}
                shell={<AdminShell>{children}</AdminShell>}
              />
              <BorjieWidgetMount />
              {/* Wave SUPERPOWERS - universal Cmd-K palette for the
                  admin console. Curated catalog covers every internal
                  route + Settings + Sign out. */}
              <AdminCommandPalette />
              {/* SOTA lazy-load Wave — Web Vitals side-channel reporter.
                  Lazy-loads web-vitals v5; ships LCP/INP/CLS/TTFB/FCP via
                  sendBeacon to /api/perf/web-vitals. Held SEPARATELY from
                  sensorium + session-replay because Web Vitals is a per-
                  page rendering measurement, not a behavioural signal. */}
              <WebVitalsReporter surface="admin-web" />
              {/* PWA — register the cache-first SW after hydration.
                  Silent; skipped in dev. See `public/sw.js` and
                  `public/offline.html`. */}
              <ServiceWorkerRegister />
            </SensoriumProvider>
          </SessionReplayProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
