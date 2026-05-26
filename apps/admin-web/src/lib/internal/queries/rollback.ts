/**
 * react-query bindings for /api/v1/mining/internal/promotions.
 *
 * Live endpoint (services/api-gateway/src/routes/mining/internal/promotions.hono.ts):
 *   GET  /                    paginated promotion list (kind / subject / since)
 *
 * The live row shape (`kind` / `subject` / `toVersion` / `promotedAt`
 * / `revertedAt`) is adapted into the legacy `PromotionRow` shape used
 * by the rollback UI. `canRevert` is true when the row has no
 * `revertedAt` and the upstream `can_revert` flag is set. Live-only:
 * failures propagate to react-query's `error` channel.
 *
 * The legacy `useRevertPromotion` mutation has no live counterpart yet
 * — it issues `POST /promotions/:id/revert` optimistically; the gateway
 * will reject with 404 until the route lands.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PromotionKind, PromotionRow } from '@/lib/internal/types';

const KEY = ['internal', 'promotions'] as const;

interface PromotionsResult {
  readonly rows: ReadonlyArray<PromotionRow>;
  readonly source: 'live';
}

interface RawPromotionRow {
  readonly id?: string;
  readonly kind?: 'prompt' | 'model' | 'corpus';
  readonly subject?: string;
  readonly promotedAt?: string;
  readonly promotedByUserId?: string;
  readonly revertedAt?: string | null;
  readonly canRevert?: boolean;
}

function adaptKind(kind: RawPromotionRow['kind']): PromotionKind {
  if (kind === 'model') return 'Model';
  if (kind === 'corpus') return 'Corpus';
  return 'Prompt';
}

function adaptPromotion(raw: RawPromotionRow): PromotionRow {
  return {
    id: raw.id ?? `promo_${Math.random().toString(36).slice(2)}`,
    kind: adaptKind(raw.kind),
    subject: raw.subject ?? 'unknown',
    promotedAt: raw.promotedAt ?? new Date().toISOString(),
    canRevert: raw.canRevert !== false && !raw.revertedAt,
    promotedBy: raw.promotedByUserId ?? 'system',
  };
}

export function usePromotionsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PromotionsResult> => {
      const res = await apiClient.get<ReadonlyArray<RawPromotionRow>>('/promotions');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptPromotion), source: 'live' };
    },
  });
}

export function useRevertPromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ readonly id: string }> => {
      const res = await apiClient.post<{ readonly id: string }>(
        `/promotions/${id}/revert`,
        {},
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<PromotionsResult>(KEY);
      if (prev) {
        qc.setQueryData<PromotionsResult>(KEY, {
          ...prev,
          rows: prev.rows.map((r) => (r.id === id ? { ...r, canRevert: false } : r)),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
