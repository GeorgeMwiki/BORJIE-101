import type { Metadata, Viewport } from 'next';
import './globals.css';
import { OwnerShell } from '@/components/OwnerShell';
import { AppProviders } from './providers';

export const metadata: Metadata = {
  title: 'Borjie — Owner Cockpit',
  description:
    'Strategic cockpit for Tanzanian mining owners. Master Brain, LMBM, cockpit dashboards, treasury, compliance — Swahili-first.',
  applicationName: 'Borjie Owner Cockpit',
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
        <AppProviders>
          <OwnerShell>{children}</OwnerShell>
        </AppProviders>
      </body>
    </html>
  );
}
