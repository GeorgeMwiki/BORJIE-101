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

interface CapitalMovementsTimelineProps {
  readonly locale: 'sw' | 'en';
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
        {isSw ? 'Inapakia mtiririko...' : 'Loading capital flows...'}
      </div>
    );
  }
  if (movementsQuery.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-6 text-sm text-destructive">
        {isSw ? 'Imeshindwa kupakia mtiririko.' : 'Could not load capital flows.'}
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
            label: isSw ? 'Mtiririko ndani (siku 30)' : 'Inflow (30d)',
            value: `TZS ${formatTzs(inflow)}`,
            sub: isSw
              ? 'Fedha zilizoingia kwenye kampuni za miliki'
              : 'Money received by estate entities',
            tone: 'success',
          },
          {
            label: isSw ? 'Mtiririko nje (siku 30)' : 'Outflow (30d)',
            value: `TZS ${formatTzs(outflow)}`,
            sub: isSw
              ? 'Fedha zilizotoka kwenye kampuni za miliki'
              : 'Money paid out by estate entities',
            tone: 'warning',
          },
          {
            label: isSw ? 'Salio (siku 30)' : 'Net (30d)',
            value: `TZS ${formatTzs(inflow - outflow)}`,
            sub: isSw
              ? 'Mwendelezo wa miliki kwa siku 30'
              : '30-day estate liquidity drift',
          },
        ]}
      />
      <SectionCard
        title={isSw ? 'Ratiba ya mtiririko' : 'Flow timeline'}
        subtitle={
          isSw
            ? `Jumla ya tukio ${movements.length} katika kumbukumbu.`
            : `${movements.length} events on record.`
        }
      >
        {movements.length === 0 ? (
          <div className="px-5 py-8 text-sm text-neutral-500">
            {isSw
              ? 'Hakuna mtiririko bado. Mtiririko wa kwanza utatengenezwa wakati LedgerService.post() inapozaa kumbukumbu ya kwanza ya kampuni-kati.'
              : 'No flows yet. First entry appears when LedgerService.post() records an intercompany ledger row.'}
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
            {fromName} {locale === 'sw' ? 'kwenda' : 'to'} {toName}
          </div>
          <div className="text-xs text-neutral-500">
            {movement.kind} · {new Date(movement.happenedAt).toISOString().slice(0, 10)}
            {movement.narrative ? ` · ${movement.narrative}` : ''}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold text-foreground">
          {movement.currency} {formatTzs(Number(movement.amount))}
        </div>
      </div>
    </li>
  );
}

function formatTzs(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toFixed(0);
}
