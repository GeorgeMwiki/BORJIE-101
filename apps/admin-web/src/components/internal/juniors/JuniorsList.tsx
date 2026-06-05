'use client';

import { useJuniorsQuery } from '@/lib/internal/queries/juniors';
import { StubBadge } from '../StubBadge';
import { DataSourceBadge } from '../DataSourceBadge';

/**
 * Live junior-template registry list.
 *
 * Binds to GET /api/v1/mining/internal/juniors and renders one row per
 * registered junior with its schema field count and whether it accepts
 * empty input. Read-only: the registry is static on the gateway and
 * there is no status-transition route, so no inline mutation is shown.
 */
export function JuniorsList(): JSX.Element {
  const query = useJuniorsQuery();

  if (query.isPending) {
    return <p className="text-sm text-neutral-500">Loading juniors…</p>;
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const rows = query.data?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-neutral-500">
            No juniors registered.
          </p>
        ) : (
          rows.map((junior) => (
            <article
              key={junior.name}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div>
                <p className="font-mono text-sm text-foreground">{junior.name}</p>
                <p className="text-xs text-neutral-400">
                  {junior.schemaFieldCount} schema field
                  {junior.schemaFieldCount === 1 ? '' : 's'}
                  {junior.acceptsEmptyInput ? ' · accepts empty input' : ''}
                </p>
              </div>
              <StubBadge tone="success">{junior.status}</StubBadge>
            </article>
          ))
        )}
      </div>
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
    </div>
  );
}
