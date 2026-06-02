/**
 * react-query bindings for /api/v1/mining/internal/support/tickets.
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/support-tickets.hono.ts):
 *   GET / — projects unresolved `compliance_escalations` rows into a thin
 *           ticket shape: { id, tenantId, source, severity, summary,
 *           openedAt, ackedAt }.
 *
 * The route is GET-only — there is NO ticket-acknowledge endpoint on the
 * gateway today, so this surface is read-only. Live-only: failures
 * propagate to react-query's `error` channel.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

const SUPPORT_KEY = ['internal', 'support-tickets'] as const;

/** Live ticket row (one unresolved compliance escalation). */
export interface SupportTicket {
  readonly id: string;
  readonly tenantId: string | null;
  readonly severity: string;
  readonly summary: string;
  readonly openedAt: string;
  readonly waitingHours: number;
}

interface SupportResult {
  readonly rows: ReadonlyArray<SupportTicket>;
  readonly source: 'live';
}

interface RawTicket {
  readonly id?: string;
  readonly tenantId?: string | null;
  readonly severity?: string;
  readonly summary?: string;
  readonly openedAt?: string;
}

function waitingHoursOf(iso: string | undefined): number {
  if (!iso) return 0;
  const dt = new Date(iso).getTime();
  if (!Number.isFinite(dt)) return 0;
  return Math.max(0, Math.round((Date.now() - dt) / 3_600_000));
}

function adaptTicket(raw: RawTicket): SupportTicket {
  return {
    id: raw.id ?? `tkt_${Math.random().toString(36).slice(2)}`,
    tenantId: raw.tenantId ?? null,
    severity: raw.severity ?? 'medium',
    summary: raw.summary ?? 'Compliance escalation',
    openedAt: raw.openedAt ?? new Date(0).toISOString(),
    waitingHours: waitingHoursOf(raw.openedAt),
  };
}

export function useSupportTicketsQuery() {
  return useQuery({
    queryKey: SUPPORT_KEY,
    queryFn: async (): Promise<SupportResult> => {
      const res = await apiClient.get<ReadonlyArray<RawTicket>>(
        '/support/tickets',
      );
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptTicket), source: 'live' };
    },
  });
}
