'use client';

import { ChevronRight, Building2 } from 'lucide-react';
import { Skeleton, Alert } from '@borjie/design-system';
import {
  useEstateGroups,
  useEstateEntities,
  type EstateEntityTreeNode,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { StatusPill } from '@/components/shared/StatusPill';
import { pickByLocale } from '@/lib/locale-shared';
import { dataAStrings as S } from '@/i18n/strings/data-a';
import { estateLabels, labelFor } from '@/i18n/strings/estate-lmbm';

interface EstateOverviewProps {
  readonly locale: 'sw' | 'en';
}

/**
 * Estate overview — top-of-stack family-office shell view.
 *
 * Shows the registered estate groups (typically one per principal
 * owner) and a tree of every estate_entity hanging off them. Click a
 * branch to drill into the entity-level detail (lands in a follow-up
 * wave alongside the entity drawer).
 */
export function EstateOverview({ locale }: EstateOverviewProps) {
  const groupsQuery = useEstateGroups();
  const entitiesQuery = useEstateEntities({ tree: true });

  if (groupsQuery.isLoading || entitiesQuery.isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-48 rounded-xl border border-border" />
        <Skeleton className="h-48 rounded-xl border border-border" />
      </div>
    );
  }

  if (groupsQuery.isError || entitiesQuery.isError) {
    return (
      <Alert variant="error">
        {pickByLocale(locale, S.estateOverview.loadError)}
      </Alert>
    );
  }

  const groups = groupsQuery.data?.data?.groups ?? [];
  const treeData = entitiesQuery.data?.data as
    | { tree: ReadonlyArray<EstateEntityTreeNode>; count: number }
    | undefined;
  const tree = treeData?.tree ?? [];

  if (groups.length === 0) {
    return (
      <SectionCard
        title={pickByLocale(locale, S.estateOverview.noEstateTitle)}
        subtitle={pickByLocale(locale, S.estateOverview.noEstateSubtitle)}
      >
        <ScreenEmptyState
          icon={<Building2 className="h-6 w-6" />}
          title={pickByLocale(locale, S.estateOverview.noEstateTitle)}
          description={pickByLocale(locale, S.estateOverview.noEstateBody)}
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <SectionCard
          key={group.id}
          title={group.name}
          subtitle={`${group.principalOwnerName} · ${group.holdingType} · ${group.country}`}
        >
          <div className="px-5 py-4">
            <EntityTreeList nodes={tree} locale={locale} />
          </div>
        </SectionCard>
      ))}
    </div>
  );
}

interface EntityTreeListProps {
  readonly nodes: ReadonlyArray<EstateEntityTreeNode>;
  readonly locale: 'sw' | 'en';
  readonly depth?: number;
}

function EntityTreeList({ nodes, locale, depth = 0 }: EntityTreeListProps) {
  if (nodes.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {locale === 'sw' ? S.estateOverview.noEntities.sw : S.estateOverview.noEntities.en}
      </div>
    );
  }
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <li key={node.entity.id}>
          <EntityRow
            node={node}
            locale={locale}
            depth={depth}
          />
          {node.children.length > 0 && (
            <div className="mt-1">
              <EntityTreeList
                nodes={node.children}
                locale={locale}
                depth={depth + 1}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

interface EntityRowProps {
  readonly node: EstateEntityTreeNode;
  readonly locale: 'sw' | 'en';
  readonly depth: number;
}

function EntityRow({ node, locale, depth }: EntityRowProps) {
  const e = node.entity;
  const tone =
    e.status === 'active'
      ? 'green'
      : e.status === 'dormant'
        ? 'amber'
        : e.status === 'divested' || e.status === 'wound_up'
          ? 'red'
          : 'neutral';
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
      style={{ marginLeft: depth * 16 }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {e.name}
          </div>
          <div className="text-xs text-muted-foreground">
            {labelFor(estateLabels.entityKind, e.kind, locale)} ·{' '}
            {Number(e.ownershipPct).toFixed(1)}%
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill
          tone={tone as 'green' | 'amber' | 'red' | 'neutral'}
          label={labelFor(estateLabels.entityStatus, e.status, locale)}
        />
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}
