'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api-client';
import type { OwnerBriefPayload } from './owner-brief';

/**
 * react-query bindings for `GET /api/v1/owner/daily-brief`.
 *
 * Returns the most recent owner-brief snapshot for today, including the
 * brain-composed `advisor` slice (warm Mr. Mwikila greeting + 3-sentence
 * EN+SW summary + insight + action). When no snapshot exists yet the
 * envelope carries `brief: null` and the card renders a "no brief yet"
 * placeholder.
 *
 * The companion `useTriggerDailyBrief()` mutation lets the owner force
 * a generate-and-dispatch right now (powered by the cron's
 * `triggerForTenant` handle).
 */

export interface DailyBriefAdvisor {
  readonly insight: string;
  readonly action: string;
  readonly greetingEn?: string;
  readonly greetingSw?: string;
  readonly summaryEn?: string;
  readonly summarySw?: string;
  readonly generatedAtIso: string;
  readonly provider: string;
  readonly latencyMs: number;
}

export type DailyBriefPayload = OwnerBriefPayload & {
  readonly advisor?: DailyBriefAdvisor | null;
};

export interface DailyBriefEnvelope {
  readonly brief: DailyBriefPayload | null;
  readonly source: 'cron' | 'on-demand' | 'daily_cron' | null;
  readonly generatedAt: string | null;
  readonly cached: boolean;
}

export interface DailyBriefTriggerResult {
  readonly tenantId: string;
  readonly generated: boolean;
  readonly snapshotId: string | null;
  readonly dispatched: number;
  readonly skipped: number;
  readonly failed: number;
  readonly reason?: string;
}

export const dailyBriefKeys = {
  all: ['daily-brief'] as const,
  today: () => [...dailyBriefKeys.all, 'today'] as const,
};

export function useDailyBrief() {
  return useQuery<DailyBriefEnvelope, ApiError>({
    queryKey: dailyBriefKeys.today(),
    queryFn: ({ signal }) =>
      apiRequest<DailyBriefEnvelope>('/api/v1/owner/daily-brief', {
        signal,
      }),
    // Keep the brief fresh for 60s — the cron will overwrite any older
    // cached copy on the next tick anyway.
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useTriggerDailyBrief() {
  const qc = useQueryClient();
  return useMutation<DailyBriefTriggerResult, ApiError, void>({
    mutationFn: () =>
      apiRequest<DailyBriefTriggerResult>(
        '/api/v1/owner/daily-brief/trigger',
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: dailyBriefKeys.today() });
    },
  });
}
