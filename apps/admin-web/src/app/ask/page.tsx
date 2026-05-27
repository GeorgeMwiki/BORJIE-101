/**
 * /ask — Talk to the industry.
 *
 * The Borjie HQ cross-tenant conversation surface. Observer voice.
 * Every assistant claim grounds in differentially-private platform
 * aggregates — no single tenant is ever named.
 *
 * Layout: 3-column on ≥lg: industry-conversation list / canvas /
 * privacy-budget + artifact pane.
 */

import { ThreadList } from '@/components/ask/ThreadList';
import { AskChat } from '@/components/ask/AskChat';
import { PrivacyBudgetCard } from '@/components/ask/PrivacyBudgetCard';

export const metadata = {
  title: 'Talk to the industry · Borjie HQ',
};

export default function IndustryAskLandingPage() {
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-thread-narrow shrink-0 border-r border-border bg-surface-sunken lg:block">
        <ThreadList />
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-border px-8 py-6">
          <p className="font-mono text-meta uppercase tracking-widest text-signal-500">
            Central intelligence · platform scope
          </p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight">
            Talk to the industry
          </h1>
          <p className="mt-2 max-w-prose-md text-sm leading-relaxed text-neutral-500">
            Across the network. Every claim is grounded in
            differentially-private aggregates. No single tenant is ever
            named. Every query costs privacy budget — the network
            remembers.
          </p>
        </header>

        <div className="flex-1 overflow-hidden">
          <AskChat threadId={null} initialMessages={[]} initialArtifacts={[]} />
        </div>
      </main>

      <aside className="hidden w-thread-medium shrink-0 flex-col gap-4 border-l border-border bg-surface px-5 py-5 lg:flex">
        <PrivacyBudgetCard />
        <div className="rounded-lg border border-border bg-background p-4">
          <p className="font-mono text-caption uppercase tracking-widest text-neutral-500">
            Observer note
          </p>
          <p className="mt-2 text-xs leading-relaxed text-neutral-500">
            I speak in the first-person plural for the industry. I
            never refer to any single tenant. If a pattern only one
            tenant shows, I refuse the query under k-anonymity.
          </p>
        </div>
      </aside>
    </div>
  );
}
