'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

/**
 * Wave OPS-WIDE query hooks — counterparties, engagements, mineral
 * chain of custody, regulatory calendar.
 *
 * Each hook hits the matching `/api/v1/ops/*` route. Tenant scope is
 * bound on the server via the `app.current_tenant_id` GUC + RLS.
 */

export const opsKeys = {
  parties: (partyType?: string, search?: string) =>
    ['ops', 'parties', partyType ?? 'all', search ?? ''] as const,
  party: (id: string) => ['ops', 'parties', id] as const,
  engagements: (partyId?: string, status?: string) =>
    ['ops', 'engagements', partyId ?? 'all', status ?? 'all'] as const,
  chain: (parcelId: string) => ['ops', 'chain', parcelId] as const,
  filings: (regulator?: string, status?: string) =>
    ['ops', 'filings', regulator ?? 'all', status ?? 'all'] as const,
};

export interface CounterpartyRow {
  readonly id: string;
  readonly partyType: string;
  readonly name: string;
  readonly tin: string | null;
  readonly brelaNo: string | null;
  readonly country: string;
  readonly region: string | null;
  readonly scorecardScore: string;
  readonly createdAt: string;
}

export function useCounterparties(opts?: {
  readonly partyType?: string;
  readonly search?: string;
}) {
  return useQuery({
    queryKey: opsKeys.parties(opts?.partyType, opts?.search),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (opts?.partyType) qs.set('partyType', opts.partyType);
      if (opts?.search) qs.set('search', opts.search);
      const suffix = qs.toString();
      return apiRequest<{
        success: boolean;
        data: { parties: ReadonlyArray<CounterpartyRow>; count: number };
      }>(`/api/v1/ops/external-parties${suffix ? `?${suffix}` : ''}`, {
        signal,
      });
    },
  });
}

export interface EngagementRow {
  readonly id: string;
  readonly partyId: string;
  readonly siteId: string | null;
  readonly kind: string;
  readonly status: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly summary: string;
  readonly auditHashId: string | null;
}

export function useEngagements(opts?: {
  readonly partyId?: string;
  readonly status?: string;
}) {
  return useQuery({
    queryKey: opsKeys.engagements(opts?.partyId, opts?.status),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (opts?.partyId) qs.set('partyId', opts.partyId);
      if (opts?.status) qs.set('status', opts.status);
      const suffix = qs.toString();
      return apiRequest<{
        success: boolean;
        data: { engagements: ReadonlyArray<EngagementRow>; count: number };
      }>(`/api/v1/ops/engagements${suffix ? `?${suffix}` : ''}`, { signal });
    },
  });
}

export interface ChainStep {
  readonly id: string;
  readonly parcelId: string;
  readonly stepIndex: number;
  readonly fromPartyId: string | null;
  readonly toPartyId: string;
  readonly action: string;
  readonly happenedAt: string;
  readonly weightGrams: string | null;
  readonly gradePct: string | null;
  readonly containerSealNo: string | null;
  readonly location: string | null;
  readonly auditHashId: string;
  readonly prevAuditHash: string;
}

export function useChainOfCustody(parcelId: string | null) {
  return useQuery({
    queryKey: opsKeys.chain(parcelId ?? ''),
    enabled: !!parcelId,
    queryFn: ({ signal }) =>
      apiRequest<{
        success: boolean;
        data: {
          parcelId: string;
          steps: ReadonlyArray<ChainStep>;
          verification: { ok: boolean; brokenAt: number | null };
          latestHash: string;
        };
      }>(
        `/api/v1/ops/chain-of-custody?parcelId=${encodeURIComponent(parcelId ?? '')}`,
        { signal },
      ),
  });
}

export interface RegulatoryFilingRow {
  readonly id: string;
  readonly regulator: string;
  readonly filingType: string;
  readonly dueAt: string;
  readonly submittedAt: string | null;
  readonly status: string;
  readonly referenceNo: string | null;
  readonly decidedOutcome: string | null;
  readonly feePaidTzs: string;
  readonly notes: string | null;
}

export function useRegulatoryFilings(opts?: {
  readonly regulator?: string;
  readonly status?: string;
  readonly dueBefore?: string;
}) {
  return useQuery({
    queryKey: opsKeys.filings(opts?.regulator, opts?.status),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (opts?.regulator) qs.set('regulator', opts.regulator);
      if (opts?.status) qs.set('status', opts.status);
      if (opts?.dueBefore) qs.set('dueBefore', opts.dueBefore);
      const suffix = qs.toString();
      return apiRequest<{
        success: boolean;
        data: {
          filings: ReadonlyArray<RegulatoryFilingRow>;
          count: number;
        };
      }>(`/api/v1/ops/regulatory-filings${suffix ? `?${suffix}` : ''}`, {
        signal,
      });
    },
  });
}
