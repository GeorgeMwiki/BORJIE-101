'use client';

import { useState } from 'react';
import { useSiteCockpit } from '@/lib/queries/site-cockpit';
import { Tabs, type TabId } from './Tabs';
import { ShiftReportCard } from './ShiftReportCard';
import { GeologyGauge } from './GeologyGauge';
import { CostTable } from './CostTable';

interface SiteCockpitSurfaceProps {
  readonly siteId: string;
}

export function SiteCockpitSurface({ siteId }: SiteCockpitSurfaceProps) {
  const { data, isLoading } = useSiteCockpit(siteId);
  const [tab, setTab] = useState<TabId>('shift');
  if (isLoading || !data) {
    return (
      <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
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
