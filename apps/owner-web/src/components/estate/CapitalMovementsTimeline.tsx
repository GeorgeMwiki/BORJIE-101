'use client';

import { ArrowRightLeft } from 'lucide-react';
import {
  useEstateCapitalMovements,
  useEstateEntities,
  type EstateCapitalMovementRow,
  type EstateEntityRow,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { MetricStrip } from '@/components/shared/MetricStrip';
import { formatLargeMoney, LAUNCH_CURRENCY } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import { dataAStrings as S } from '@/i18n/strings/data-a';

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
      <div className="rounded-lg border border-border bg-surface px-6 py-10 text-sm text-neutral-400">
        {isSw ? S.capitalMovements.loading.sw : S.capitalMovements.loading.en}
      </div>
    );
  }
  if (movementsQuery.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-6 text-sm text-destructive">
        {isSw ? S.capitalMovements.loadError.sw : S.capitalMovements.loadError.en}
      </div>
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
  let inflow = 0;
  let outflow = 0;
  for (const m of movements) {
    const t = new Date(m.happenedAt).getTime();
    if (t < thirtyDaysAgo) continue;
    const v = Number(m.amount);
    if (m.toEntityId) inflow += v;
    if (m.fromEntityId) outflow += v;
  }

  return (
    <div className="space-y-6">
      <MetricStrip
        cols={3}
        tiles={[
          {
            label: isSw ? S.capitalMovements.inflowLabel.sw : S.capitalMovements.inflowLabel.en,
            value: formatLargeMoney(inflow, LAUNCH_CURRENCY, locale),
            sub: isSw ? S.capitalMovements.inflowSub.sw : S.capitalMovements.inflowSub.en,
            tone: 'success',
          },
          {
            label: isSw ? S.capitalMovements.outflowLabel.sw : S.capitalMovements.outflowLabel.en,
            value: formatLargeMoney(outflow, LAUNCH_CURRENCY, locale),
            sub: isSw ? S.capitalMovements.outflowSub.sw : S.capitalMovements.outflowSub.en,
            tone: 'warning',
          },
          {
            label: isSw ? S.capitalMovements.netLabel.sw : S.capitalMovements.netLabel.en,
            value: formatLargeMoney(inflow - outflow, LAUNCH_CURRENCY, locale),
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
          <div className="px-5 py-8 text-sm text-neutral-500">
            {isSw ? S.capitalMovements.empty.sw : S.capitalMovements.empty.en}
          </div>
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
  const fromName = movement.fromEntityId
    ? nameById.get(movement.fromEntityId) ?? 'external'
    : 'external';
  const toName = movement.toEntityId
    ? nameById.get(movement.toEntityId) ?? 'external'
    : 'external';
  return (
    <li className="flex items-start justify-between gap-3 px-5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <ArrowRightLeft className="mt-1 h-4 w-4 shrink-0 text-neutral-500" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {fromName} {locale === 'sw' ? S.capitalMovements.to.sw : S.capitalMovements.to.en} {toName}
          </div>
          <div className="text-xs text-neutral-500">
            {movement.kind} · {new Date(movement.happenedAt).toISOString().slice(0, 10)}
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
