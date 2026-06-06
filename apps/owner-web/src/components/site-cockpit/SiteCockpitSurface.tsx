'use client';

import { useState } from 'react';
import { useSiteCockpit } from '@/lib/queries/site-cockpit';
import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/shared/EmptyState';
import { Tabs, type TabId } from './Tabs';
import { ShiftReportCard } from './ShiftReportCard';
import { GeologyGauge } from './GeologyGauge';
import { CostTable } from './CostTable';

interface SiteCockpitSurfaceProps {
  readonly siteId: string;
}

export function SiteCockpitSurface({ siteId }: SiteCockpitSurfaceProps) {
  const { data, isLoading, isError, error } = useSiteCockpit(siteId);
  const [tab, setTab] = useState<TabId>('shift');

  if (isLoading) {
    return (
      <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
    );
  }
  // Honest error states — no more infinite spinner. A 404 means the site id
  // (from the query param / deep link) doesn't resolve for this tenant.
  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <EmptyState
        title={notFound ? 'Site not found' : 'Could not load this site'}
        description={
          notFound
            ? 'This site does not exist for your account, or the link is stale. Pick a site from the selector above.'
            : `The site cockpit failed to load. ${
                error instanceof Error ? error.message : 'Please try again.'
              }`
        }
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        title="No site data yet"
        description="This site has no shift, geology, or cost data recorded yet."
      />
    );
  }
  return (
    <Tabs active={tab} onChange={setTab}>
      {tab === 'shift' ? (
        <ShiftReportCard
          latest={data.latestShift}
          blockers={data.blockers}
          photos={data.photos}
        />
      ) : null}
      {tab === 'geology' ? (
        <GeologyGauge score={data.geologyScore} trend={data.geologyTrend} />
      ) : null}
      {tab === 'cost' ? <CostTable costs={data.costs} /> : null}
    </Tabs>
  );
}
