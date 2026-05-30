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
import { StatusBoard } from '@/components/StatusBoard';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'System Status — Borjie',
  description:
    'Live status and 90-day uptime for the Borjie platform — API gateway, database, auth, storage, workers, realtime.',
};

export default async function StatusPage() {
  const locale = await getLocale();
  const c = getMessages(locale).statusPage;

  return (
    <>
      
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
        <p className="mt-3 text-sm leading-relaxed text-foreground/70">
          {c.sub}
        </p>

        <div className="mt-10">
          <StatusBoard locale={locale} />
        </div>

        <p className="mt-10 text-xs leading-relaxed text-foreground/60">
          {c.subscribeNote}
        </p>
      </main>
      
    </>
  );
}
