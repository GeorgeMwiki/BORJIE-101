'use client';

import { useState } from 'react';
import { Skeleton } from '@borjie/design-system';
import { useSiteCockpit } from '@/lib/queries/site-cockpit';
import { ApiError, localizeError } from '@/lib/api-client';
import { EmptyState } from '@/components/shared/EmptyState';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { cockpitClusterStrings as S } from '@/i18n/strings/cockpit-cluster';
import { Tabs, type TabId } from './Tabs';
import { ShiftReportCard } from './ShiftReportCard';
import { GeologyGauge } from './GeologyGauge';
import { CostTable } from './CostTable';

interface SiteCockpitSurfaceProps {
  readonly siteId: string;
  readonly initialLocale?: Locale;
}

export function SiteCockpitSurface({
  siteId,
  initialLocale,
}: SiteCockpitSurfaceProps) {
  const locale = useLocale(initialLocale);
  const { data, isLoading, isError, error } = useSiteCockpit(siteId);
  const [tab, setTab] = useState<TabId>('shift');

  if (isLoading) {
    return <Skeleton className="h-chart-sm rounded-lg border border-border" />;
  }
  // Honest error states — no more infinite spinner. A 404 means the site id
  // (from the query param / deep link) doesn't resolve for this tenant.
  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <EmptyState
        title={pickByLocale(
          locale,
          notFound ? S.siteSurface.notFoundTitle : S.siteSurface.errorTitle,
        )}
        description={
          notFound
            ? pickByLocale(locale, S.siteSurface.notFoundBody)
            : pickByLocale(
                locale,
                // Localize by stable CODE — never the raw English `.message`
                // under `sw` (language MIXING).
                S.siteSurface.errorBody(localizeError(error, locale)),
              )
        }
      />
    );
  }
  if (!data) {
    return (
      <EmptyState
        title={pickByLocale(locale, S.siteSurface.noDataTitle)}
        description={pickByLocale(locale, S.siteSurface.noDataBody)}
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
          initialLocale={locale}
        />
      ) : null}
      {tab === 'geology' ? (
        <GeologyGauge score={data.geologyScore} trend={data.geologyTrend} />
      ) : null}
      {tab === 'cost' ? <CostTable costs={data.costs} initialLocale={locale} /> : null}
    </Tabs>
  );
}
