import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'Borjie — AI-native operating system for Tanzanian mining',
  description:
    'Borjie is the AI-native operating system for Tanzanian mining. Master Brain, licence calendar, drill-hole logger, FX & treasury, marketplace, compliance pack. Swahili-first. Multi-tenant. Multi-lingual.',
  applicationName: 'Borjie',
  metadataBase: new URL('https://borjie.co.tz'),
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
    url: 'https://borjie.co.tz',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Borjie — AI-native OS for Tanzanian mining',
    description:
      'Run your mine like the world\'s best. Master Brain, licence calendar, FX & treasury, marketplace, compliance pack.',
    creator: '@borjie_tz',
  },
  alternates: {
    canonical: 'https://borjie.co.tz',
    languages: {
      sw: 'https://borjie.co.tz',
      en: 'https://borjie.co.tz?lang=en',
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
  return (
    <html lang={locale} className="dark">
      <body className="bg-background text-foreground antialiased min-h-screen">
        <a href="#main-content" className="skip-link">
          {locale === 'sw' ? 'Ruka kwenye maudhui' : 'Skip to main content'}
        </a>
        {children}
      </body>
    </html>
  );
}
