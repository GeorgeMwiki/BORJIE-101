'use client';

import { Building2 } from 'lucide-react';
import { Skeleton, Alert } from '@borjie/design-system';
import { useEstateEntities, type EstateEntityRow } from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { StatusPill } from '@/components/shared/StatusPill';
import { pickByLocale } from '@/lib/locale-shared';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import { estateLabels, labelFor } from '@/i18n/strings/estate-lmbm';

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
    return <Skeleton className="h-64 rounded-xl border border-border" />;
  }
  if (query.isError) {
    return (
      <Alert variant="error">
        {pickByLocale(locale, S.entitiesList.loadError)}
      </Alert>
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
        <ScreenEmptyState
          icon={<Building2 className="h-6 w-6" />}
          title={pickByLocale(locale, S.entitiesList.emptyTitle)}
          description={pickByLocale(locale, S.entitiesList.empty)}
        />
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
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <div>
          <div className="text-sm font-medium text-foreground">
            {entity.name}
          </div>
          <div className="text-xs text-muted-foreground">
            {locale === 'sw' ? S.entitiesList.kindPrefix.sw : S.entitiesList.kindPrefix.en}
            {labelFor(estateLabels.entityKind, entity.kind, locale)} ·{' '}
            {Number(entity.ownershipPct).toFixed(1)}%
            {entity.brelaNo ? ` · BRELA ${entity.brelaNo}` : ''}
          </div>
        </div>
      </div>
      <StatusPill
        tone={tone as 'green' | 'amber' | 'red' | 'neutral'}
        label={labelFor(estateLabels.entityStatus, entity.status, locale)}
      />
    </li>
  );
}
