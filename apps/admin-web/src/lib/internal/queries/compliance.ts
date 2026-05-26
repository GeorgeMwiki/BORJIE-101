/**
 * react-query bindings for /api/v1/mining/internal/compliance-queue.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/compliance-queue.hono.ts):
 *   GET    /                       paginated open-by-default queue
 *   POST   /:id/approve            resolve as approved
 *   POST   /:id/reject             resolve as rejected
 *
 * The live row shape comes from `compliance_escalations` (id /
 * tenantId / severity lowercase / summary / escalatedAt). The adapter
 * shims that into the legacy `ComplianceItem` shape used by the queue
 * UI. Live-only: failures propagate to react-query's `error` channel.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ComplianceItem, ComplianceSeverity } from '@/lib/internal/types';

const KEY = ['internal', 'compliance-queue'] as const;

interface QueueResult {
  readonly rows: ReadonlyArray<ComplianceItem>;
  readonly source: 'live';
}

interface RawEscalationRow {
  readonly id?: string;
  readonly tenantId?: string | null;
  readonly severity?: 'low' | 'medium' | 'high' | 'critical';
  readonly summary?: string;
  readonly escalatedAt?: string;
}

function adaptSeverity(s: RawEscalationRow['severity']): ComplianceSeverity {
  if (s === 'low') return 'Low';
  if (s === 'high' || s === 'critical') return 'High';
  return 'Medium';
}

function waitingHoursOf(iso: string | undefined): number {
  if (!iso) return 0;
  const dt = new Date(iso).getTime();
  if (!Number.isFinite(dt)) return 0;
  return Math.max(0, Math.round((Date.now() - dt) / 3_600_000));
}

function adaptEscalation(raw: RawEscalationRow): ComplianceItem {
  const tenantId = raw.tenantId ?? 'platform';
  return {
    id: raw.id ?? `esc_${Math.random().toString(36).slice(2)}`,
    tenantId,
    tenant: tenantId,
    summary: raw.summary ?? 'Compliance escalation',
    severity: adaptSeverity(raw.severity),
    waitingHours: waitingHoursOf(raw.escalatedAt),
  };
}

export function useComplianceQueueQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<QueueResult> => {
      const res = await apiClient.get<ReadonlyArray<RawEscalationRow>>('/compliance-queue');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptEscalation), source: 'live' };
    },
  });
}

interface DecisionInput {
  readonly id: string;
  readonly decision: 'approve' | 'reject';
}

export function useResolveCompliance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision }: DecisionInput): Promise<{ readonly id: string }> => {
      const res = await apiClient.post<{ readonly id: string }>(
        `/compliance-queue/${id}/${decision}`,
        {},
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<QueueResult>(KEY);
      if (prev) {
        qc.setQueryData<QueueResult>(KEY, { ...prev, rows: prev.rows.filter((r) => r.id !== id) });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
