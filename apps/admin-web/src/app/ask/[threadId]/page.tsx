/**
 * /ask/[threadId] — a live industry-observer thread.
 */

import { ThreadList } from '@/components/ask/ThreadList';
import { AskChat } from '@/components/ask/AskChat';
import { AuditTrailPanel } from '@/components/ask/AuditTrailPanel';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';

export const dynamic = 'force-dynamic';

interface ThreadPageProps {
  readonly params: Promise<{ readonly threadId: string }>;
}

export default async function IndustryThreadPage({ params }: ThreadPageProps) {
  const { threadId } = await params;
  // Seed the chat's first paint from the server-resolved `borjie_locale`
  // cookie so SSR + the first client render agree with the `<html lang>`
  // the root layout stamped (zero-mix canon — no EN-under-SW frame). The
  // header chrome + the audit panel title resolve through the SAME locale.
  const locale = await readLocaleFromServerCookies();
  const threadLabel = pickByLocale(locale, {
    en: `Thread ${threadId.slice(0, 12)}`,
    sw: `Mazungumzo ${threadId.slice(0, 12)}`,
  });
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-thread-narrow shrink-0 border-r border-border bg-surface-sunken lg:block">
        <ThreadList activeThreadId={threadId} />
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-border px-8 py-5">
          <p className="font-mono text-meta uppercase tracking-widest text-signal-500">
            {pickByLocale(locale, {
              en: 'Industry conversation',
              sw: 'Mazungumzo ya sekta',
            })}
          </p>
          <h1 className="mt-1 font-display text-2xl font-medium tracking-tight">
            {threadLabel}
          </h1>
        </header>

        <div className="flex-1 overflow-hidden">
          <AskChat
            threadId={threadId}
            initialMessages={[]}
            initialArtifacts={[]}
            initialLocale={locale}
          />
        </div>
      </main>

      <aside className="hidden w-thread-wide shrink-0 flex-col gap-4 border-l border-border bg-surface lg:flex">
        <div className="min-h-0 flex-1">
          <AuditTrailPanel
            threadId={threadId}
            scope="platform"
            fetchUrl={buildAuditUrl(threadId)}
            initialLocale={locale}
            title={threadLabel}
          />
        </div>
      </aside>
    </div>
  );
}

function buildAuditUrl(threadId: string): string {
  const base = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  const path = `/api/v1/intelligence/thread/${encodeURIComponent(threadId)}/audit?scope=platform&limit=500`;
  return base ? `${base}${path}` : path;
}
