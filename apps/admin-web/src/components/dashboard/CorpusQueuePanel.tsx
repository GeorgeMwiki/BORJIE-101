'use client';

import Link from 'next/link';
import { Card } from '@borjie/design-system';
import { useDashboardCorpus } from '@/lib/internal/queries/dashboard';
import { useLocale, pickByLocale } from '@/lib/locale';

// BCP-47 tag per active language for locale-correct date formatting. Region
// tailoring is resolved upstream; here we only vary the language axis so the
// timestamp never renders in a fixed foreign format.
const DATE_TAG = { en: 'en-GB', sw: 'sw-TZ' } as const;

const S = {
  unavailableTitle: {
    en: 'Corpus queue unavailable',
    sw: 'Foleni ya korasi haipatikani',
  },
  endpointUnreachable: { en: 'Endpoint unreachable', sw: 'Mwisho haufikiki' },
  heading: { en: 'Intelligence corpus', sw: 'Korasi ya akili' },
  indexedSuperseded: {
    en: 'indexed chunks · {n} superseded',
    sw: 'vipande vilivyofahirisiwa · {n} vimebadilishwa',
  },
  manage: { en: 'Manage →', sw: 'Simamia →' },
  totalIngested: { en: 'Total ingested', sw: 'Jumla iliyoingizwa' },
  latestIngest: { en: 'Latest ingest', sw: 'Uingizaji wa hivi karibuni' },
  empty: {
    en: 'No corpus chunks ingested yet. Use the corpus screen to upload the first dossier.',
    sw: 'Hakuna vipande vya korasi vilivyoingizwa bado. Tumia skrini ya korasi kupakia jalada la kwanza.',
  },
} as const;

/**
 * Corpus ingest queue panel — middle-left.
 *
 * Reads `/mining/internal/corpus/versions` and reports the total
 * chunk count, how many are still active (not superseded), and the
 * latest ingest timestamp. Deep-link to the corpus management screen
 * for the operator to manage uploads / supersession.
 */
export function CorpusQueuePanel(): JSX.Element {
  const locale = useLocale();
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
          {pickByLocale(locale, S.unavailableTitle)}
        </h2>
        <p className="mt-2 text-sm text-neutral-300">
          {query.error instanceof Error
            ? query.error.message
            : pickByLocale(locale, S.endpointUnreachable)}
        </p>
      </article>
    );
  }

  const { total, indexed, superseded, latestIngestAt } = query.data;

  return (
    <Card className="p-5" data-testid="admin-dashboard-corpus">
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-caption uppercase tracking-widest text-neutral-500">
            {pickByLocale(locale, S.heading)}
          </h2>
          <p className="mt-1 font-display text-3xl text-foreground">
            {indexed}
          </p>
          <p className="text-xs text-neutral-500">
            {pickByLocale(locale, S.indexedSuperseded).replace(
              '{n}',
              String(superseded),
            )}
          </p>
        </div>
        <Link
          href="/internal/corpus"
          className="text-xs text-signal-500 underline underline-offset-4"
        >
          {pickByLocale(locale, S.manage)}
        </Link>
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-neutral-500">
            {pickByLocale(locale, S.totalIngested)}
          </dt>
          <dd className="mt-1 text-foreground">{total}</dd>
        </div>
        <div>
          <dt className="text-xs text-neutral-500">
            {pickByLocale(locale, S.latestIngest)}
          </dt>
          <dd className="mt-1 text-foreground">
            {latestIngestAt
              ? new Date(latestIngestAt).toLocaleString(
                  pickByLocale(locale, DATE_TAG),
                  {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  },
                )
              : '—'}
          </dd>
        </div>
      </dl>
      {total === 0 ? (
        <p
          className="mt-3 text-sm text-neutral-400"
          data-testid="admin-dashboard-corpus-empty"
        >
          {pickByLocale(locale, S.empty)}
        </p>
      ) : null}
    </Card>
  );
}
