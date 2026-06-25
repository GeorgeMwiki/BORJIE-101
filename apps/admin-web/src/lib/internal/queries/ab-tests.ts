/**
 * react-query bindings for /api/v1/mining/internal/ab-tests.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/ab-tests.hono.ts):
 *   GET  /                    list experiments (ab_experiments, migration 0300)
 *   POST /                    create an experiment ({ variant, junior, ... })
 *   POST /:id/promote-winner  flip status → 'promoted' + stamp promotedAt
 *
 * Live-only: failures propagate to react-query's `error` channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, toApiError } from '@/lib/api-client';

const AB_KEY = ['internal', 'ab-tests'] as const;

export interface Experiment {
  readonly id: string;
  readonly tenantId: string | null;
  readonly variant: string;
  readonly junior: string;
  readonly goldenScore: number | null;
  readonly canaryTenants: ReadonlyArray<string>;
  readonly status: string;
  readonly promotedAt: string | null;
  readonly createdAt: string;
}

interface RawExperiment {
  readonly id?: string;
  readonly tenantId?: string | null;
  readonly variant?: string;
  readonly junior?: string;
  readonly goldenScore?: number | null;
  readonly canaryTenants?: ReadonlyArray<string>;
  readonly status?: string;
  readonly promotedAt?: string | null;
  readonly createdAt?: string;
}

function adaptExperiment(raw: RawExperiment): Experiment {
  return {
    id: raw.id ?? '',
    tenantId: raw.tenantId ?? null,
    variant: raw.variant ?? '',
    junior: raw.junior ?? '',
    goldenScore: raw.goldenScore ?? null,
    canaryTenants: raw.canaryTenants ?? [],
    status: raw.status ?? 'running',
    promotedAt: raw.promotedAt ?? null,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
  };
}

export function useExperimentsQuery() {
  return useQuery({
    queryKey: AB_KEY,
    queryFn: async (): Promise<ReadonlyArray<Experiment>> => {
      const res =
        await apiClient.get<ReadonlyArray<RawExperiment>>('/ab-tests');
      if (!res.ok) throw toApiError(res);
      return res.data.map(adaptExperiment);
    },
  });
}

export interface CreateExperimentInput {
  readonly variant: string;
  readonly junior: string;
  readonly goldenScore?: number;
  readonly canaryTenants?: ReadonlyArray<string>;
  readonly tenantId?: string;
  readonly notes?: string;
}

export function useCreateExperiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExperimentInput): Promise<Experiment> => {
      const res = await apiClient.post<RawExperiment>('/ab-tests', input);
      if (!res.ok) throw toApiError(res);
      return adaptExperiment(res.data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: AB_KEY }),
  });
}

export function usePromoteWinner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<Experiment> => {
      const res = await apiClient.post<RawExperiment>(
        `/ab-tests/${encodeURIComponent(id)}/promote-winner`,
        {},
      );
      if (!res.ok) throw toApiError(res);
      return adaptExperiment(res.data);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: AB_KEY }),
  });
}
