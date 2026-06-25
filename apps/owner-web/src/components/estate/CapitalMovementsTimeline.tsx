'use client';

import { ArrowRightLeft } from 'lucide-react';
import { Skeleton, Alert } from '@borjie/design-system';
import {
  useEstateCapitalMovements,
  useEstateEntities,
  type EstateCapitalMovementRow,
  type EstateEntityRow,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { MetricStrip } from '@/components/shared/MetricStrip';
import { formatLargeMoney, fmtDateForLocale, LAUNCH_CURRENCY } from '@/lib/format';
import { pickByLocale } from '@/lib/locale-shared';
import type { Locale } from '@/lib/locale-shared';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import {
  estateLabels,
  labelFor,
  capitalMovementExtra,
} from '@/i18n/strings/estate-lmbm';

interface CapitalMovementsTimelineProps {
  readonly locale: Locale;
}

/**
 * Chronological log of every estate_capital_movement under the active
 * tenant. Above the timeline, three KPIs: gross inflow last 30d, gross
 * outflow last 30d, net last 30d.
 */
export function CapitalMovementsTimeline({
  locale,
}: CapitalMovementsTimelineProps) {
  const movementsQuery = useEstateCapitalMovements({ limit: 200 });
  const entitiesQuery = useEstateEntities();
  const isSw = locale === 'sw';

  if (movementsQuery.isLoading || entitiesQuery.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl border border-border" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl border border-border" />
      </div>
    );
  }
  if (movementsQuery.isError) {
    return (
      <Alert variant="error">
        {pickByLocale(locale, S.capitalMovements.loadError)}
      </Alert>
    );
  }
  const movements = movementsQuery.data?.data?.movements ?? [];
  const entities =
    (entitiesQuery.data?.data as
      | { entities: ReadonlyArray<EstateEntityRow>; count: number }
      | undefined)?.entities ?? [];
  const nameById = new Map<string, string>();
  for (const e of entities) nameById.set(e.id, e.name);

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 86_400_000;
  // Aggregate PER currency-code — never sum across distinct ISO codes into
  // one figure. Each KPI renders one figure when all 30d movements share a
  // currency, or a per-currency breakdown when they differ.
  const inflowByCcy = new Map<string, number>();
  const outflowByCcy = new Map<string, number>();
  for (const m of movements) {
    const t = new Date(m.happenedAt).getTime();
    if (t < thirtyDaysAgo) continue;
    const v = Number(m.amount);
    const ccy = (m.currency || LAUNCH_CURRENCY).trim().toUpperCase();
    if (m.toEntityId) inflowByCcy.set(ccy, (inflowByCcy.get(ccy) ?? 0) + v);
    if (m.fromEntityId) outflowByCcy.set(ccy, (outflowByCcy.get(ccy) ?? 0) + v);
  }
  // Net per currency drawn from the union of inflow/outflow codes.
  const netByCcy = new Map<string, number>();
  for (const ccy of new Set([...inflowByCcy.keys(), ...outflowByCcy.keys()])) {
    netByCcy.set(ccy, (inflowByCcy.get(ccy) ?? 0) - (outflowByCcy.get(ccy) ?? 0));
  }

  const renderByCcy = (byCcy: Map<string, number>): string => {
    const entries = [...byCcy.entries()];
    if (entries.length === 0) return formatLargeMoney(0, LAUNCH_CURRENCY, locale);
    return entries
      .map(([ccy, amount]) => formatLargeMoney(amount, ccy, locale))
      .join(' · ');
  };

  return (
    <div className="space-y-6">
      <MetricStrip
        cols={3}
        tiles={[
          {
            label: isSw ? S.capitalMovements.inflowLabel.sw : S.capitalMovements.inflowLabel.en,
            value: renderByCcy(inflowByCcy),
            sub: isSw ? S.capitalMovements.inflowSub.sw : S.capitalMovements.inflowSub.en,
            tone: 'success',
          },
          {
            label: isSw ? S.capitalMovements.outflowLabel.sw : S.capitalMovements.outflowLabel.en,
            value: renderByCcy(outflowByCcy),
            sub: isSw ? S.capitalMovements.outflowSub.sw : S.capitalMovements.outflowSub.en,
            tone: 'warning',
          },
          {
            label: isSw ? S.capitalMovements.netLabel.sw : S.capitalMovements.netLabel.en,
            value: renderByCcy(netByCcy),
            sub: isSw ? S.capitalMovements.netSub.sw : S.capitalMovements.netSub.en,
          },
        ]}
      />
      <SectionCard
        title={isSw ? S.capitalMovements.timelineTitle.sw : S.capitalMovements.timelineTitle.en}
        subtitle={
          isSw
            ? S.capitalMovements.timelineSubtitle(movements.length).sw
            : S.capitalMovements.timelineSubtitle(movements.length).en
        }
      >
        {movements.length === 0 ? (
          <ScreenEmptyState
            icon={<ArrowRightLeft className="h-6 w-6" />}
            title={pickByLocale(locale, S.capitalMovements.emptyTitle)}
            description={pickByLocale(locale, S.capitalMovements.empty)}
          />
        ) : (
          <ul className="divide-y divide-border">
            {movements.map((m) => (
              <FlowRow
                key={m.id}
                movement={m}
                nameById={nameById}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

interface FlowRowProps {
  readonly movement: EstateCapitalMovementRow;
  readonly nameById: Map<string, string>;
  readonly locale: 'sw' | 'en';
}

function FlowRow({ movement, nameById, locale }: FlowRowProps) {
  const external = pickByLocale(locale, capitalMovementExtra.external);
  const fromName = movement.fromEntityId
    ? nameById.get(movement.fromEntityId) ?? external
    : external;
  const toName = movement.toEntityId
    ? nameById.get(movement.toEntityId) ?? external
    : external;
  return (
    <li className="flex items-start justify-between gap-3 px-5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <ArrowRightLeft className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {fromName} {locale === 'sw' ? S.capitalMovements.to.sw : S.capitalMovements.to.en} {toName}
          </div>
          <div className="text-xs text-muted-foreground">
            {labelFor(estateLabels.capitalMovementKind, movement.kind, locale)} ·{' '}
            {fmtDateForLocale(movement.happenedAt, locale)}
            {movement.narrative ? ` · ${movement.narrative}` : ''}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold text-foreground">
          {formatLargeMoney(Number(movement.amount), movement.currency, locale)}
        </div>
      </div>
    </li>
  );
}
