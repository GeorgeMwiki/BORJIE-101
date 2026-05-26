/**
 * react-query bindings for /api/v1/mining/internal/audit-log.
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/audit-log.hono.ts):
 *   GET  /                    cursor-paginated WORM audit list
 *   query: tenantId?, junior?, cursor?, limit?
 *   response.meta: { nextCursor, limit, count }
 *
 * Live-only: failures propagate to react-query's `error` channel.
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { AuditEvent } from '@/lib/internal/types';

const KEY = ['internal', 'audit-log'] as const;

interface AuditLogResult {
  readonly rows: ReadonlyArray<AuditEvent>;
  readonly source: 'live';
}

interface RawAuditRow {
  readonly id?: string;
  readonly sequenceNumber?: number;
  readonly createdAt?: string;
  readonly recordedAt?: string;
  readonly tenantId?: string;
  readonly tenantName?: string;
  readonly actorId?: string;
  readonly actorName?: string;
  readonly action?: string;
  readonly resource?: string;
}

function adaptAudit(raw: RawAuditRow): AuditEvent {
  return {
    id: raw.id ?? String(raw.sequenceNumber ?? Math.random()),
    at: raw.createdAt ?? raw.recordedAt ?? new Date().toISOString(),
    tenant: raw.tenantName ?? raw.tenantId ?? 'unknown',
    tenantId: raw.tenantId ?? 'unknown',
    actor: raw.actorName ?? raw.actorId ?? 'system',
    action: raw.action ?? 'audit.event',
    ...(raw.resource !== undefined ? { target: raw.resource } : {}),
  };
}

export function useAuditLogQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AuditLogResult> => {
      const res = await apiClient.get<ReadonlyArray<RawAuditRow>>('/audit-log');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptAudit), source: 'live' };
    },
  });
}

interface AuditLogPage {
  readonly rows: ReadonlyArray<AuditEvent>;
  readonly nextCursor: number | null;
  readonly source: 'live';
}

interface AuditLogFilters {
  readonly tenantId?: string;
  readonly junior?: string;
  readonly limit?: number;
}

const PAGE_SIZE = 50;

/**
 * Cursor-paginated audit log. Live-only.
 */
export function useAuditLogPages(filters: AuditLogFilters = {}) {
  const limit = filters.limit ?? PAGE_SIZE;
  return useInfiniteQuery({
    queryKey: [...KEY, 'pages', filters] as const,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }): Promise<AuditLogPage> => {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (filters.tenantId) params.set('tenantId', filters.tenantId);
      if (filters.junior) params.set('junior', filters.junior);
      if (pageParam !== null && pageParam !== undefined) params.set('cursor', String(pageParam));

      type Envelope = {
        readonly data: ReadonlyArray<RawAuditRow>;
        readonly meta?: { readonly nextCursor: number | null };
      };
      const res = await apiClient.get<Envelope>(`/audit-log?${params.toString()}`);
      if (!res.ok) throw new Error(res.message);
      const envelope = res.data;
      return {
        rows: envelope.data.map(adaptAudit),
        nextCursor: envelope.meta?.nextCursor ?? null,
        source: 'live',
      };
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}
