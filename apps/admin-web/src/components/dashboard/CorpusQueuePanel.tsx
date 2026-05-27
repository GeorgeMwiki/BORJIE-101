'use client';

import Link from 'next/link';
import { useDashboardCorpus } from '@/lib/internal/queries/dashboard';

/**
 * Corpus ingest queue panel — middle-left.
 *
 * Reads `/mining/internal/corpus/versions` and reports the total
 * chunk count, how many are still active (not superseded), and the
 * latest ingest timestamp. Deep-link to the corpus management screen
 * for the operator to manage uploads / supersession.
 */
export function CorpusQueuePanel(): JSX.Element {
  const query = useDashboardCorpus();

  if (query.isLoading) {
    return (
      <div
        className="h-44 animate-pulse rounded-lg border border-border bg-surface/40"
        data-testid="admin-dashboard-corpus-skeleton"
      />
    );
  }

  if (query.error || !query.data) {
    return (
      <article
        className="rounded-lg border border-warning/40 bg-warning-subtle/10 p-5"
        data-testid="admin-dashboard-corpus-error"
      >
        <h2 className="text-caption uppercase tracking-widest text-warning">
          Corpus queue unavailable
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          {query.error instanceof Error
            ? query.error.message
            : 'Endpoint unreachable'}
        </p>
      </article>
    );
  }

  const { total, indexed, superseded, latestIngestAt } = query.data;

  return (
    <article
      className="rounded-lg border border-border bg-surface p-5"
      data-testid="admin-dashboard-corpus"
    >
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            Intelligence corpus
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {indexed}
          </p>
          <p className="text-xs text-neutral-500">
            indexed chunks · {superseded} superseded
          </p>
        </div>
        <Link
          href="/internal/corpus"
          className="text-xs text-signal-500 underline underline-offset-4"
        >
          Manage →
        </Link>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-neutral-500">Total ingested</dt>
          <dd className="mt-1 text-foreground">{total}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">Latest ingest</dt>
          <dd className="mt-1 text-foreground">
            {latestIngestAt
              ? new Date(latestIngestAt).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'}
          </dd>
        </div>
      </dl>
      {total === 0 ? (
        <p
          className="mt-3 text-sm text-neutral-400"
          data-testid="admin-dashboard-corpus-empty"
        >
          No corpus chunks ingested yet. Use the corpus screen to upload the
          first dossier.
        </p>
      ) : null}
    </article>
  );
}
