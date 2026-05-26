import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SensoriumProvider } from '@/lib/sensorium/SensoriumProvider';
import { SessionReplayProvider } from '@/components/SessionReplayProvider';
import { BorjieWidgetMount } from '@/components/BorjieWidgetMount';

export const metadata: Metadata = {
  title: {
    default: 'Borjie Console — Internal Admin',
    template: '%s — Borjie Console',
  },
  description:
    'Borjie Console — internal admin surfaces for tenants, intelligence corpus, prompt and model registry, compliance review, audit logs, and platform killswitch.',
  applicationName: 'Borjie Console',
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
    <html lang="en" className="dark">
      <body className="bg-background text-foreground antialiased min-h-screen">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {/* Central Command Phase A — C4 Sensorium / Brain Skin.
            Wires the 14-event sensory bus to every page in the portal so
            the brain (Mr. Mwikila) senses what the operator is doing in
            real time. Side-channel only — never blocks render. */}
        {/* Central Command Phase B — B5 Session Replay (rrweb cold store).
            Held SEPARATELY from the sensorium taxonomy: mouse-move replay
            at ≈20Hz lives here; it is NEVER fed into the LLM context. */}
        <SessionReplayProvider surface="admin-web">
          <SensoriumProvider surface="admin-web">
            {children}
            <BorjieWidgetMount />
          </SensoriumProvider>
        </SessionReplayProvider>
      </body>
    </html>
  );
}
