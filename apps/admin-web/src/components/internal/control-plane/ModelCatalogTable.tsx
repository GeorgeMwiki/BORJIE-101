'use client';

import {
  Skeleton,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@borjie/design-system';
import { StubBadge } from '../StubBadge';
import { useModelCatalogQuery } from '@/lib/internal/control-plane/queries';
import type { CatalogModel } from '@/lib/internal/control-plane/api';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

function capabilityTone(rank: number): 'success' | 'info' | 'neutral' {
  if (rank >= 5) return 'success';
  if (rank >= 3) return 'info';
  return 'neutral';
}

const S = {
  emptyTitle: { en: 'No models in the catalog', sw: 'Hakuna miundo katika katalogi' },
  emptyBody: {
    en: 'Assignable models appear here once the catalog is populated.',
    sw: 'Miundo inayoweza kuwekwa huonekana hapa mara katalogi inapojazwa.',
  },
  colModel: { en: 'Model', sw: 'Muundo' },
  colFamily: { en: 'Family', sw: 'Familia' },
  colProvider: { en: 'Provider', sw: 'Mtoaji' },
  colCapability: { en: 'Capability', sw: 'Uwezo' },
  colCost: { en: 'Cost / 1M tok', sw: 'Gharama / tokeni 1M' },
  colLatency: { en: 'p50 latency', sw: 'Ucheleweshaji p50' },
  rank: { en: 'rank', sw: 'cheo' },
  locked: {
    en: 'Locked / sovereign use-cases (pinned to their policy floor, not reassignable):',
    sw: 'Matumizi yaliyofungwa / huru (yamebandikwa kwenye sera yao ya msingi, hayawezi kupangwa upya):',
  },
} as const;

/**
 * MODEL CATALOG — read-only table of the assignable models with their
 * cost / capability / latency metadata, sourced live from GET /model-catalog.
 * Informs the routing pickers; never mutates anything.
 */
export function ModelCatalogTable({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useModelCatalogQuery();

  if (query.isPending) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-9 w-2/3 rounded-md" />
      </div>
    );
  }
  if (query.isError) {
    return <p className="text-sm text-danger">{query.error.message}</p>;
  }

  const models: ReadonlyArray<CatalogModel> = query.data?.models ?? [];

  if (models.length === 0) {
    return (
      <EmptyState
        title={pickByLocale(locale, S.emptyTitle)}
        description={pickByLocale(locale, S.emptyBody)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{pickByLocale(locale, S.colModel)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colFamily)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colProvider)}</TableHead>
              <TableHead>{pickByLocale(locale, S.colCapability)}</TableHead>
              <TableHead className="text-right">{pickByLocale(locale, S.colCost)}</TableHead>
              <TableHead className="text-right">{pickByLocale(locale, S.colLatency)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m.model}>
                <TableCell>
                  <p className="text-foreground">{m.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">{m.model}</p>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{m.family}</TableCell>
                <TableCell className="text-muted-foreground">{m.provider}</TableCell>
                <TableCell>
                  <StubBadge tone={capabilityTone(m.capabilityRank)}>
                    {pickByLocale(locale, S.rank)} {m.capabilityRank}
                  </StubBadge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  ${m.costPerMillionUsd.toFixed(2)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {m.p50LatencyMs} ms
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {query.data?.lockedUseCases && query.data.lockedUseCases.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {pickByLocale(locale, S.locked)}{' '}
          <span className="font-mono text-muted-foreground">
            {query.data.lockedUseCases.join(', ')}
          </span>
        </p>
      ) : null}
    </div>
  );
}
