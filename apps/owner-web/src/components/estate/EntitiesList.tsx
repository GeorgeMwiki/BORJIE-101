'use client';

import { Building2 } from 'lucide-react';
import { useEstateEntities, type EstateEntityRow } from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { StatusPill } from '@/components/shared/StatusPill';
import { dataAStrings as S } from '@/i18n/strings/data-a';

interface EntitiesListProps {
  readonly locale: 'sw' | 'en';
}

/**
 * Flat list of every estate entity under the active tenant. Filterable
 * by kind in a follow-up wave; today the rows show name, kind,
 * ownership percentage, and status pill.
 */
export function EntitiesList({ locale }: EntitiesListProps) {
  const query = useEstateEntities();
  const isSw = locale === 'sw';

  if (query.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface px-6 py-10 text-sm text-neutral-400">
        {isSw ? S.entitiesList.loading.sw : S.entitiesList.loading.en}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-6 text-sm text-destructive">
        {isSw ? S.entitiesList.loadError.sw : S.entitiesList.loadError.en}
      </div>
    );
  }
  const payload = query.data?.data as
    | { entities: ReadonlyArray<EstateEntityRow>; count: number }
    | undefined;
  const rows = payload?.entities ?? [];

  return (
    <SectionCard
      title={isSw ? S.entitiesList.title.sw : S.entitiesList.title.en}
      subtitle={
        isSw
          ? S.entitiesList.subtitle(rows.length).sw
          : S.entitiesList.subtitle(rows.length).en
      }
    >
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-sm text-neutral-500">
          {isSw ? S.entitiesList.empty.sw : S.entitiesList.empty.en}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((e) => (
            <EntityListRow key={e.id} entity={e} locale={locale} />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

interface EntityListRowProps {
  readonly entity: EstateEntityRow;
  readonly locale: 'sw' | 'en';
}

function EntityListRow({ entity, locale }: EntityListRowProps) {
  const tone =
    entity.status === 'active'
      ? 'green'
      : entity.status === 'dormant'
        ? 'amber'
        : entity.status === 'divested' || entity.status === 'wound_up'
          ? 'red'
          : 'neutral';
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="flex items-center gap-3">
        <Building2 className="h-4 w-4 text-neutral-500" />
        <div>
          <div className="text-sm font-medium text-foreground">
            {entity.name}
          </div>
          <div className="text-xs text-neutral-500">
            {locale === 'sw' ? S.entitiesList.kindPrefix.sw : S.entitiesList.kindPrefix.en}
            {entity.kind} · {Number(entity.ownershipPct).toFixed(1)}%
            {entity.brelaNo ? ` · BRELA ${entity.brelaNo}` : ''}
          </div>
        </div>
      </div>
      <StatusPill
        tone={tone as 'green' | 'amber' | 'red' | 'neutral'}
        label={entity.status}
      />
    </li>
  );
}
