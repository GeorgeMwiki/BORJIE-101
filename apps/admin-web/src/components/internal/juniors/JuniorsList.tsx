'use client';

import { Skeleton, EmptyState } from '@borjie/design-system';
import { useJuniorsQuery } from '@/lib/internal/queries/juniors';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

const S = {
  loading: { en: 'Loading juniors…', sw: 'Inapakia wadogo…' },
  emptyTitle: { en: 'No juniors registered', sw: 'Hakuna wadogo waliosajiliwa' },
  emptyBody: {
    en: 'Registered juniors appear here once the gateway exposes them.',
    sw: 'Wadogo waliosajiliwa huonekana hapa mara lango linapowaonyesha.',
  },
  fieldsOne: { en: 'schema field', sw: 'sehemu ya muundo' },
  fieldsMany: { en: 'schema fields', sw: 'sehemu za muundo' },
  acceptsEmpty: { en: 'accepts empty input', sw: 'hukubali ingizo tupu' },
} as const;

/**
 * Live junior-template registry list.
 *
 * Binds to GET /api/v1/mining/internal/juniors and renders one row per
 * registered junior with its schema field count and whether it accepts
 * empty input. Read-only: the registry is static on the gateway and
 * there is no status-transition route, so no inline mutation is shown.
 */
export function JuniorsList({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useJuniorsQuery();

  if (query.isPending) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-full rounded-md" />
        <Skeleton className="h-12 w-2/3 rounded-md" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'mock'} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.map((junior) => (
          <article
            key={junior.name}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <div>
              <p className="font-mono text-sm text-foreground">{junior.name}</p>
              <p className="text-xs text-muted-foreground">
                {junior.schemaFieldCount}{' '}
                {junior.schemaFieldCount === 1
                  ? pickByLocale(locale, S.fieldsOne)
                  : pickByLocale(locale, S.fieldsMany)}
                {junior.acceptsEmptyInput
                  ? ` · ${pickByLocale(locale, S.acceptsEmpty)}`
                  : ''}
              </p>
            </div>
            <StubBadge tone="success">{junior.status}</StubBadge>
          </article>
        ))}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
    </div>
  );
}
