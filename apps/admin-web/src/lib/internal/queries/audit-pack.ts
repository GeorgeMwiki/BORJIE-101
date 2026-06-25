/**
 * react-query bindings for /api/v1/mining/internal/audit-pack.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/audit-pack.hono.ts):
 *   GET  /       list issued packs (audit_packs, migration 0300)
 *   POST /mint   create a pending pack row ({ tenantId, regulator })
 *
 * Honest signed-URL semantics: a freshly minted pack has `status='pending'`
 * and `signedUrl=null` — the gateway NEVER fabricates a URL. The download
 * link only appears once a real bundling/presign step fills it. Live-only:
 * failures propagate to react-query's `error` channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, toApiError } from '@/lib/api-client';

const PACKS_KEY = ['internal', 'audit-packs'] as const;

export interface AuditPack {
  readonly id: string;
  readonly tenantId: string;
  readonly regulator: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly signedUrl: string | null;
  readonly status: string;
}

interface RawPack {
  readonly id?: string;
  readonly tenantId?: string;
  readonly regulator?: string;
  readonly issuedAt?: string;
  readonly expiresAt?: string | null;
  readonly signedUrl?: string | null;
  readonly status?: string;
}

function adaptPack(raw: RawPack): AuditPack {
  return {
    id: raw.id ?? '',
    tenantId: raw.tenantId ?? '',
    regulator: raw.regulator ?? '',
    issuedAt: raw.issuedAt ?? new Date(0).toISOString(),
    expiresAt: raw.expiresAt ?? null,
    signedUrl: raw.signedUrl ?? null,
    status: raw.status ?? 'pending',
  };
}

export function useAuditPacksQuery() {
  return useQuery({
    queryKey: PACKS_KEY,
    queryFn: async (): Promise<ReadonlyArray<AuditPack>> => {
      const res = await apiClient.get<ReadonlyArray<RawPack>>('/audit-pack');
      if (!res.ok) throw toApiError(res);
      return res.data.map(adaptPack);
    },
  });
}

export interface MintPackInput {
  readonly tenantId: string;
  readonly regulator: string;
}

export function useMintAuditPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MintPackInput): Promise<AuditPack> => {
      const res = await apiClient.post<RawPack>('/audit-pack/mint', input);
      if (!res.ok) throw toApiError(res);
      return adaptPack(res.data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PACKS_KEY }),
  });
}
