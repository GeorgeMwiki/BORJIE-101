/**
 * Public status page.
 *
 * Polls GET /api/v1/public/status (see api-gateway public-status.router)
 * every 30 s. Shows current state for: API Gateway, Database, Auth,
 * Storage, Workers, Realtime — plus the last 90 days of daily
 * worst-status as a uptime heat-strip per component.
 *
 * Bilingual sw/en via existing getMessages + Nav/Footer chrome.
 */
import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { StatusBoard } from '@/components/StatusBoard';
import { getLocale } from '@/lib/locale';

export const metadata: Metadata = {
  title: 'System Status — Borjie',
  description:
    'Live status and 90-day uptime for the Borjie platform — API gateway, database, auth, storage, workers, realtime.',
};

interface StatusCopy {
  readonly kicker: string;
  readonly heading: string;
  readonly sub: string;
  readonly subscribeNote: string;
}

const COPY: Record<'sw' | 'en', StatusCopy> = {
  sw: {
    kicker: 'Hali ya mfumo',
    heading: 'Hali ya Borjie',
    sub: 'Hali ya sasa ya huduma zetu na historia ya siku 90 zilizopita.',
    subscribeNote:
      'Hali hii inasasishwa kila baada ya sekunde 30. Iwapo kuna tatizo kubwa, tutawasilisha taarifa kwa wateja wote walioathirika kupitia barua pepe.',
  },
  en: {
    kicker: 'System status',
    heading: 'Borjie status',
    sub: 'Live status of our services and a 90-day uptime history.',
    subscribeNote:
      'This page refreshes every 30 seconds. For major incidents, we email all affected customers directly.',
  },
};

export default async function StatusPage() {
  const locale = await getLocale();
  const c = COPY[locale];

  return (
    <>
      <Nav locale={locale} />
      <main
        id="main-content"
        className="mx-auto max-w-3xl px-6 pb-24 pt-20 lg:px-8"
      >
        <p className="font-mono text-xs uppercase tracking-widest text-signal-500">
          {c.kicker}
        </p>
        <h1 className="mt-4 font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          {c.heading}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          {c.sub}
        </p>

        <div className="mt-10">
          <StatusBoard locale={locale} />
        </div>

        <p className="mt-10 text-xs leading-relaxed text-neutral-500">
          {c.subscribeNote}
        </p>
      </main>
      <Footer locale={locale} />
    </>
  );
}
