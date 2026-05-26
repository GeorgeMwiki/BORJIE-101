/**
 * react-query bindings for /api/v1/mining/internal/audit-log.
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/audit-log.hono.ts):
 *   GET  /                    cursor-paginated WORM audit list
 *   query: tenantId?, junior?, cursor?, limit?
 *   response.meta: { nextCursor, limit, count }
 *
 * Exposes two hooks:
 *   useAuditLogQuery()        single-page snapshot (back-compat).
 *   useAuditLogPages()        cursor-based useInfiniteQuery; lets the
 *                             virtual list page lazily.
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_AUDIT_LOG } from '@/lib/mocks/audit-log';
import type { AuditEvent } from '@/lib/mocks/types';

const KEY = ['internal', 'audit-log'] as const;

interface AuditLogResult {
  readonly rows: ReadonlyArray<AuditEvent>;
  readonly source: 'live' | 'mock';
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
    target: raw.resource,
  };
}

export function useAuditLogQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AuditLogResult> => {
      const res = await apiClient.get<ReadonlyArray<RawAuditRow | AuditEvent>>(
        '/audit-log',
        async () => MOCK_AUDIT_LOG,
      );
      if (!res.ok) throw new Error(res.message);
      const rows =
        res.source === 'live'
          ? (res.data as ReadonlyArray<RawAuditRow>).map(adaptAudit)
          : (res.data as ReadonlyArray<AuditEvent>);
      return { rows, source: res.source };
    },
  });
}

interface AuditLogPage {
  readonly rows: ReadonlyArray<AuditEvent>;
  readonly nextCursor: number | null;
  readonly source: 'live' | 'mock';
}

interface AuditLogFilters {
  readonly tenantId?: string;
  readonly junior?: string;
  readonly limit?: number;
}

const PAGE_SIZE = 50;

/**
 * Cursor-paginated audit log. The mock path slices the in-memory
 * fixture by sequence number so the same UI works offline.
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
      const res = await apiClient.get<Envelope>(`/audit-log?${params.toString()}`, async () => {
        const start = pageParam === null ? 0 : Math.max(0, MOCK_AUDIT_LOG.length - pageParam);
        const slice = MOCK_AUDIT_LOG.slice(start, start + limit);
        return {
          data: slice as unknown as ReadonlyArray<RawAuditRow>,
          meta: {
            nextCursor:
              start + slice.length < MOCK_AUDIT_LOG.length
                ? MOCK_AUDIT_LOG.length - (start + slice.length)
                : null,
          },
        };
      });
      if (!res.ok) throw new Error(res.message);
      const envelope = res.data;
      const rows =
        res.source === 'live'
          ? envelope.data.map(adaptAudit)
          : (envelope.data as unknown as ReadonlyArray<AuditEvent>);
      return { rows, nextCursor: envelope.meta?.nextCursor ?? null, source: res.source };
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}
