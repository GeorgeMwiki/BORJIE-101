/**
 * react-query bindings for /api/v1/mining/internal/regulator-pipeline.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/regulator-pipeline.hono.ts):
 *   GET    /                 paginated kanban list (filter: source, status)
 *   PATCH  /:id/stage        move an entry to the next kanban stage
 *
 * The live row shape (`source` enum lowercase, `status` instead of
 * `stage`, `capturedAt` timestamp) is adapted into the legacy
 * `RegulatorChange` shape. Live-only: failures propagate to react-
 * query's `error` channel.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type {
  CitationSource,
  RegulatorChange,
  RegulatorStage,
} from '@/lib/internal/types';

const KEY = ['internal', 'regulator-pipeline'] as const;

interface PipelineResult {
  readonly rows: ReadonlyArray<RegulatorChange>;
  readonly source: 'live';
}

interface RawRegulatorRow {
  readonly id?: string;
  readonly source?: 'gazette' | 'nemc' | 'bot' | 'tra' | 'tumemadini';
  readonly title?: string;
  readonly status?: RegulatorStage;
  readonly capturedAt?: string;
}

const SOURCE_LABELS: Record<NonNullable<RawRegulatorRow['source']>, CitationSource> = {
  gazette: 'Gazette',
  nemc: 'NEMC',
  bot: 'BoT',
  tra: 'TRA',
  tumemadini: 'Tumemadini',
};

function ageHoursOf(iso: string | undefined): number {
  if (!iso) return 0;
  const dt = new Date(iso).getTime();
  if (!Number.isFinite(dt)) return 0;
  return Math.max(0, Math.round((Date.now() - dt) / 3_600_000));
}

function adaptRegulator(raw: RawRegulatorRow): RegulatorChange {
  return {
    id: raw.id ?? `reg_${Math.random().toString(36).slice(2)}`,
    source: raw.source ? SOURCE_LABELS[raw.source] : 'Gazette',
    title: raw.title ?? 'Untitled change',
    stage: raw.status ?? 'incoming',
    ageHours: ageHoursOf(raw.capturedAt),
  };
}

export function useRegulatorPipelineQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PipelineResult> => {
      const res = await apiClient.get<ReadonlyArray<RawRegulatorRow>>('/regulator-pipeline');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptRegulator), source: 'live' };
    },
  });
}

interface MoveInput {
  readonly id: string;
  readonly stage: RegulatorStage;
}

export function useMoveRegulatorChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: MoveInput): Promise<RegulatorChange> => {
      const res = await apiClient.patch<RawRegulatorRow>(
        `/regulator-pipeline/${id}/stage`,
        { stage },
      );
      if (!res.ok) throw new Error(res.message);
      return adaptRegulator(res.data);
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<PipelineResult>(KEY);
      if (prev) {
        qc.setQueryData<PipelineResult>(KEY, {
          ...prev,
          rows: prev.rows.map((r) => (r.id === id ? { ...r, stage } : r)),
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
