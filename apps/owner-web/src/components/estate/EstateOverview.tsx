'use client';

import { ChevronRight, Building2 } from 'lucide-react';
import {
  useEstateGroups,
  useEstateEntities,
  type EstateEntityTreeNode,
} from '@/lib/queries/estate';
import { SectionCard } from '@/components/shared/SectionCard';
import { StatusPill } from '@/components/shared/StatusPill';

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
  const isSw = locale === 'sw';

  if (groupsQuery.isLoading || entitiesQuery.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-surface px-6 py-10 text-sm text-neutral-400">
        {isSw ? 'Inapakia miliki...' : 'Loading estate...'}
      </div>
    );
  }

  if (groupsQuery.isError || entitiesQuery.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-6 py-6 text-sm text-destructive">
        {isSw
          ? 'Imeshindwa kupakia data ya miliki.'
          : 'Could not load estate data.'}
      </div>
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
        title={isSw ? 'Hakuna miliki bado' : 'No estate registered yet'}
        subtitle={
          isSw
            ? 'Sajili kikundi cha familia chini ya /api/v1/estate/groups ili kuanza.'
            : 'Register a family-office group via /api/v1/estate/groups to begin.'
        }
      >
        <div className="px-5 py-6 text-sm text-neutral-400">
          {isSw
            ? 'Mwambie Mr. Mwikila aanze kwa "tengeneza family office".'
            : 'Ask Mr. Mwikila to "create a family office" to begin.'}
        </div>
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
      <div className="text-sm text-neutral-500">
        {locale === 'sw' ? 'Hakuna kampuni.' : 'No entities yet.'}
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
        <Building2 className="h-4 w-4 shrink-0 text-neutral-500" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {e.name}
          </div>
          <div className="text-xs text-neutral-500">
            {e.kind} · {Number(e.ownershipPct).toFixed(1)}%
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={tone as 'green' | 'amber' | 'red' | 'neutral'} label={e.status} />
        <ChevronRight className="h-4 w-4 text-neutral-500" />
      </div>
    </div>
  );
}
