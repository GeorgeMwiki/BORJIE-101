'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/**
 * Wave ESTATE-OS query hooks — family-office shell, entities, capital
 * movements, succession plans, asset register.
 *
 * Each hook hits the matching `/api/v1/estate/*` route. Tenant scope
 * is bound on the server via the `app.tenant_id` GUC + RLS.
 */

export const estateKeys = {
  groups: () => ['estate', 'groups'] as const,
  entities: (groupId?: string, kind?: string, tree?: boolean) =>
    [
      'estate',
      'entities',
      groupId ?? 'all',
      kind ?? 'all',
      tree ? 'tree' : 'flat',
    ] as const,
  capitalMovements: (filters?: {
    fromEntityId?: string;
    toEntityId?: string;
    since?: string;
    until?: string;
    kind?: string;
  }) =>
    [
      'estate',
      'capital-movements',
      filters?.fromEntityId ?? 'all',
      filters?.toEntityId ?? 'all',
      filters?.since ?? 'any',
      filters?.until ?? 'any',
      filters?.kind ?? 'all',
    ] as const,
  successionPlans: (groupId?: string) =>
    ['estate', 'succession-plans', groupId ?? 'all'] as const,
  assets: (entityId?: string, assetClass?: string) =>
    [
      'estate',
      'assets',
      entityId ?? 'all',
      assetClass ?? 'all',
    ] as const,
};

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface EstateGroupRow {
  readonly id: string;
  readonly name: string;
  readonly holdingType: string;
  readonly country: string;
  readonly principalOwnerName: string;
  readonly principalOwnerNida: string | null;
  readonly principalOwnerTin: string | null;
  readonly foundingYear: number | null;
  readonly createdAt: string;
}

export function useEstateGroups() {
  return useQuery({
    queryKey: estateKeys.groups(),
    queryFn: ({ signal }) =>
      apiRequest<{
        success: boolean;
        data: { groups: ReadonlyArray<EstateGroupRow>; count: number };
      }>('/api/v1/estate/groups', { signal }),
  });
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface EstateEntityRow {
  readonly id: string;
  readonly estateGroupId: string;
  readonly name: string;
  readonly kind: string;
  readonly brelaNo: string | null;
  readonly tin: string | null;
  readonly ownershipPct: string;
  readonly parentEntityId: string | null;
  readonly status: string;
  readonly foundedAt: string | null;
  readonly divestedAt: string | null;
  readonly createdAt: string;
}

export interface EstateEntityTreeNode {
  readonly entity: EstateEntityRow;
  readonly children: ReadonlyArray<EstateEntityTreeNode>;
}

export function useEstateEntities(opts?: {
  readonly groupId?: string;
  readonly kind?: string;
  readonly tree?: boolean;
}) {
  return useQuery({
    queryKey: estateKeys.entities(opts?.groupId, opts?.kind, opts?.tree),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (opts?.groupId) qs.set('groupId', opts.groupId);
      if (opts?.kind) qs.set('kind', opts.kind);
      if (opts?.tree) qs.set('tree', '1');
      const suffix = qs.toString();
      return apiRequest<{
        success: boolean;
        data:
          | { tree: ReadonlyArray<EstateEntityTreeNode>; count: number }
          | { entities: ReadonlyArray<EstateEntityRow>; count: number };
      }>(`/api/v1/estate/entities${suffix ? `?${suffix}` : ''}`, { signal });
    },
  });
}

// ---------------------------------------------------------------------------
// Capital movements
// ---------------------------------------------------------------------------

export interface EstateCapitalMovementRow {
  readonly id: string;
  readonly fromEntityId: string | null;
  readonly toEntityId: string | null;
  readonly kind: string;
  readonly amount: string;
  readonly currency: string;
  readonly happenedAt: string;
  readonly narrative: string | null;
}

export function useEstateCapitalMovements(opts?: {
  readonly fromEntityId?: string;
  readonly toEntityId?: string;
  readonly since?: string;
  readonly until?: string;
  readonly kind?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: estateKeys.capitalMovements(opts),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (opts?.fromEntityId) qs.set('fromEntityId', opts.fromEntityId);
      if (opts?.toEntityId) qs.set('toEntityId', opts.toEntityId);
      if (opts?.since) qs.set('since', opts.since);
      if (opts?.until) qs.set('until', opts.until);
      if (opts?.kind) qs.set('kind', opts.kind);
      if (opts?.limit) qs.set('limit', String(opts.limit));
      const suffix = qs.toString();
      return apiRequest<{
        success: boolean;
        data: {
          movements: ReadonlyArray<EstateCapitalMovementRow>;
          count: number;
        };
      }>(
        `/api/v1/estate/capital-movements${suffix ? `?${suffix}` : ''}`,
        { signal },
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Succession plans
// ---------------------------------------------------------------------------

export interface SuccessionPlanRow {
  readonly id: string;
  readonly estateGroupId: string;
  readonly currentPrincipalName: string;
  readonly designatedSuccessorName: string;
  readonly designatedSuccessorRelation: string;
  readonly designatedSuccessorNida: string | null;
  readonly contingencySuccessorName: string | null;
  readonly willDocId: string | null;
  readonly lastReviewAt: string;
  readonly nextReviewDueAt: string;
  readonly status: string;
  readonly notes: string | null;
}

export function useSuccessionPlans(opts?: { readonly groupId?: string }) {
  return useQuery({
    queryKey: estateKeys.successionPlans(opts?.groupId),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (opts?.groupId) qs.set('groupId', opts.groupId);
      const suffix = qs.toString();
      return apiRequest<{
        success: boolean;
        data: { plans: ReadonlyArray<SuccessionPlanRow>; count: number };
      }>(
        `/api/v1/estate/succession-plans${suffix ? `?${suffix}` : ''}`,
        { signal },
      );
    },
  });
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface EstateAssetRow {
  readonly id: string;
  readonly estateEntityId: string;
  readonly assetClass: string;
  readonly descriptor: string;
  readonly acquiredAt: string | null;
  readonly acquiredCostTzs: string | null;
  readonly currentValueTzs: string;
  readonly valuationMethod: string;
  readonly valuationAt: string;
  readonly location: string | null;
  readonly insuredUntil: string | null;
  readonly encumbrances: ReadonlyArray<unknown>;
}

export function useEstateAssets(opts?: {
  readonly entityId?: string;
  readonly assetClass?: string;
  readonly limit?: number;
}) {
  return useQuery({
    queryKey: estateKeys.assets(opts?.entityId, opts?.assetClass),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (opts?.entityId) qs.set('entityId', opts.entityId);
      if (opts?.assetClass) qs.set('assetClass', opts.assetClass);
      if (opts?.limit) qs.set('limit', String(opts.limit));
      const suffix = qs.toString();
      return apiRequest<{
        success: boolean;
        data: { assets: ReadonlyArray<EstateAssetRow>; count: number };
      }>(
        `/api/v1/estate/assets${suffix ? `?${suffix}` : ''}`,
        { signal },
      );
    },
  });
}
