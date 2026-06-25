/**
 * react-query bindings for /api/v1/mining/internal/feature-flags.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/feature-flags.hono.ts):
 *   GET   /                     platform feature-flag catalog (feature_flags)
 *   PATCH /:flagKey/rollout      flip the platform default ({ defaultEnabled })
 *
 * NOTE: the canonical `feature_flags` row carries a BOOLEAN
 * `defaultEnabled` (on/off), NOT a rollout percentage — the live toggle
 * is therefore an enable/disable, mirrored here. Live-only: failures
 * propagate to react-query's `error` channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, toApiError } from '@/lib/api-client';

const FLAGS_KEY = ['internal', 'feature-flags'] as const;

/** Live platform feature-flag row. */
export interface FeatureFlag {
  readonly flagKey: string;
  readonly description: string | null;
  readonly defaultEnabled: boolean;
  readonly updatedAt: string | null;
}

interface FlagsResult {
  readonly rows: ReadonlyArray<FeatureFlag>;
  readonly source: 'live';
}

interface RawFlag {
  readonly flagKey?: string;
  readonly description?: string | null;
  readonly defaultEnabled?: boolean;
  readonly updatedAt?: string | null;
}

function adaptFlag(raw: RawFlag): FeatureFlag {
  return {
    flagKey: raw.flagKey ?? 'unknown',
    description: raw.description ?? null,
    defaultEnabled: Boolean(raw.defaultEnabled),
    updatedAt: raw.updatedAt ?? null,
  };
}

export function useFeatureFlagsQuery() {
  return useQuery({
    queryKey: FLAGS_KEY,
    queryFn: async (): Promise<FlagsResult> => {
      const res = await apiClient.get<ReadonlyArray<RawFlag>>('/feature-flags');
      if (!res.ok) throw toApiError(res);
      return { rows: res.data.map(adaptFlag), source: 'live' };
    },
  });
}

interface ToggleInput {
  readonly flagKey: string;
  readonly defaultEnabled: boolean;
}

export function useToggleFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ flagKey, defaultEnabled }: ToggleInput): Promise<FeatureFlag> => {
      const res = await apiClient.patch<RawFlag>(
        `/feature-flags/${encodeURIComponent(flagKey)}/rollout`,
        { defaultEnabled },
      );
      if (!res.ok) throw toApiError(res);
      return adaptFlag(res.data);
    },
    onMutate: async ({ flagKey, defaultEnabled }) => {
      await qc.cancelQueries({ queryKey: FLAGS_KEY });
      const previous = qc.getQueryData<FlagsResult>(FLAGS_KEY);
      if (previous) {
        qc.setQueryData<FlagsResult>(FLAGS_KEY, {
          ...previous,
          rows: previous.rows.map((f) =>
            f.flagKey === flagKey ? { ...f, defaultEnabled } : f,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(FLAGS_KEY, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: FLAGS_KEY }),
  });
}
