'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export const maintenanceKeys = {
  list: (since?: string) => ['maintenance', 'list', since ?? 'all'] as const,
};

export interface MaintenanceEvent {
  readonly id: string;
  readonly assetId: string;
  readonly kind: string;
  readonly status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  readonly summary: string | null;
  readonly downtimeHours: string | null;
  readonly costTzs: string | null;
  readonly scheduledFor: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

const KIND_MAP: Readonly<Record<'preventive' | 'corrective' | 'inspection', string>> = {
  preventive: 'scheduled_service',
  corrective: 'repair',
  inspection: 'inspection',
};

export type UiMaintenanceKind = keyof typeof KIND_MAP;

export interface CreateMaintenanceInput {
  readonly assetId: string;
  readonly kind: UiMaintenanceKind;
  readonly summary?: string;
  readonly etaHours?: number;
}

/**
 * Fetch maintenance events. The api-gateway route returns the last
 * `limit` rows; we ask for 500 and trim client-side to the 30-day
 * window the screen advertises.
 */
export function useMaintenanceList(sinceIso: string) {
  return useQuery({
    queryKey: maintenanceKeys.list(sinceIso),
    queryFn: ({ signal }) =>
      apiRequest<ReadonlyArray<MaintenanceEvent>>(
        `/api/v1/mining/maintenance?limit=500`,
        { signal },
      ),
    select: (rows) =>
      (rows ?? []).filter((row) => {
        const ts = row.startedAt ?? row.createdAt;
        return ts >= sinceIso;
      }),
    staleTime: 60_000,
  });
}

/**
 * POST /api/v1/mining/maintenance — maps the UI kind enum to the
 * gateway MaintenanceKindEnum and folds `etaHours` into the summary
 * so the existing schema accepts it without a backend change.
 */
export function useCreateMaintenance() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMaintenanceInput) => {
      const body = {
        assetId: input.assetId,
        kind: KIND_MAP[input.kind],
        status: 'open' as const,
        summary: [input.summary, input.etaHours ? `ETA: ${input.etaHours}h` : null]
          .filter((value): value is string => Boolean(value))
          .join(' · '),
      };
      return apiRequest<MaintenanceEvent>(`/api/v1/mining/maintenance`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['maintenance', 'list'] });
    },
  });
}
