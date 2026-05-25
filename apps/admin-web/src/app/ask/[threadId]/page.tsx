/**
 * /ask/[threadId] — a live industry-observer thread.
 */

import { ThreadList } from '@/components/ask/ThreadList';
import { AskChat } from '@/components/ask/AskChat';
import { PrivacyBudgetCard } from '@/components/ask/PrivacyBudgetCard';
import { AuditTrailPanel } from '@/components/ask/AuditTrailPanel';

export const dynamic = 'force-dynamic';

interface ThreadPageProps {
  readonly params: Promise<{ readonly threadId: string }>;
}

export default async function IndustryThreadPage({ params }: ThreadPageProps) {
  const { threadId } = await params;
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-[280px] shrink-0 border-r border-border bg-surface-sunken lg:block">
        <ThreadList activeThreadId={threadId} />
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-border px-8 py-5">
          <p className="font-mono text-[0.68rem] uppercase tracking-widest text-signal-500">
            Industry conversation
          </p>
          <h1 className="mt-1 font-display text-2xl font-medium tracking-tight">
            Thread {threadId.slice(0, 12)}
          </h1>
        </header>

        <div className="flex-1 overflow-hidden">
          <AskChat
            threadId={threadId}
            initialMessages={[]}
            initialArtifacts={[]}
          />
        </div>
      </main>

      <aside className="hidden w-[360px] shrink-0 flex-col gap-4 border-l border-border bg-surface lg:flex">
        <div className="px-5 pt-5">
          <PrivacyBudgetCard />
        </div>
        <div className="min-h-0 flex-1">
          <AuditTrailPanel
            threadId={threadId}
            scope="platform"
            fetchUrl={buildAuditUrl(threadId)}
            title={`Thread ${threadId.slice(0, 12)}`}
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
