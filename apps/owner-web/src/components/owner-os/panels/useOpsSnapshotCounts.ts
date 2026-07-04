'use client';

import { useSitesList } from '@/lib/queries/sites';
import { useIncidents } from '@/lib/queries/safety';
import { useHeadcount } from '@/lib/queries/people';

/** Honest placeholder for a count whose source has not resolved. */
const PENDING = '—';

/**
 * A metric-tile value: either an honest '—' (source pending/errored — never
 * a fabricated 0) or the stringified real count.
 */
type CountValue = string;

/**
 * Producing-site test — mirrors the `phaseOf(...) === 'production'`
 * classification the sibling <SitesList> uses for its phase chips, so the
 * KPI tile and the list agree on what "producing" means.
 */
function isProducing(phase: string | undefined): boolean {
  return (phase ?? '').toLowerCase().includes('prod');
}

/**
 * Live counts for the Ops-tab KPI strip, drawn from the SAME endpoints the
 * on-screen sibling surfaces already fetch:
 *   - producingSites → GET /api/v1/mining/sites        (as <SitesList>)
 *   - openIncidents  → GET /api/v1/mining/incidents     (as <SafetySurface>)
 *   - onShift        → GET /api/v1/mining/attendance/headcount
 *
 * Each tile falls back to an honest '—' while its query is pending or
 * errored — a number is only shown once the real source has settled, so the
 * strip never fabricates a 0 beside real rows and a genuinely-empty tenant
 * still reads a truthful 0.
 */
export interface OpsSnapshotCounts {
  readonly producingSites: CountValue;
  readonly openIncidents: CountValue;
  readonly onShift: CountValue;
}

export function useOpsSnapshotCounts(): OpsSnapshotCounts {
  const sitesQuery = useSitesList();
  const incidentsQuery = useIncidents({ status: 'open', limit: 200 });
  const headcountQuery = useHeadcount();

  const producingSites =
    sitesQuery.isSuccess && sitesQuery.data
      ? String(sitesQuery.data.filter((site) => isProducing(site.phase)).length)
      : PENDING;

  const openIncidents =
    incidentsQuery.isSuccess && incidentsQuery.data
      ? String(incidentsQuery.data.length)
      : PENDING;

  const onShift =
    headcountQuery.isSuccess && headcountQuery.data
      ? String(
          headcountQuery.data.perSite.reduce(
            (sum, site) => sum + site.headcount,
            0,
          ),
        )
      : PENDING;

  return { producingSites, openIncidents, onShift };
}
