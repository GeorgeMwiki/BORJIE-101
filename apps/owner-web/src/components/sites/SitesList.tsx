'use client';

import Link from 'next/link';
import { SectionCard } from '@/components/shared/SectionCard';
import { useSitesList } from '@/lib/queries/sites';

/**
 * Render every mining site under the active tenant. Live data comes
 * from `/api/v1/mining/sites`; falls back to an empty list when the
 * gateway is unreachable (the empty state copy makes that obvious).
 */
export function SitesList(): JSX.Element {
  const query = useSitesList();
  const sites = query.data ?? [];

  if (query.isPending) {
    return (
      <SectionCard title="Sites">
        <div className="h-24 animate-pulse rounded-md bg-surface/50" />
      </SectionCard>
    );
  }

  if (query.isError) {
    return (
      <SectionCard title="Sites">
        <p className="text-sm text-destructive">Failed to load sites.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={`Sites (${sites.length})`}>
      {sites.length === 0 ? (
        <p className="text-xs text-neutral-500">
          No sites returned. The gateway may be offline or the active tenant
          has no sites yet.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {sites.map((site) => (
            <li
              key={site.id}
              className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
            >
              <div>
                <div className="text-foreground">{site.name}</div>
                <div className="text-xs text-neutral-500">
                  {[site.phase, site.status, site.licenceId].filter(Boolean).join(' - ')}
                </div>
              </div>
              <Link
                href={`/site-cockpit?siteId=${encodeURIComponent(site.id)}`}
                className="text-xs text-signal-500 hover:underline"
              >
                Open cockpit
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
