/**
 * react-query bindings for /api/v1/mining/internal/prompts.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/prompts.hono.ts):
 *   GET   /              list prompt registry rows
 *   POST  /promote       promote (capability, version) → canary
 *
 * Live-only: failures propagate to react-query's `error` channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { PromptRow, PromptStatus } from '@/lib/internal/types';

const KEY = ['internal', 'prompts'] as const;

interface PromptsResult {
  readonly rows: ReadonlyArray<PromptRow>;
  readonly source: 'live';
}

interface RawPromptRow {
  readonly id?: string;
  readonly capability?: string;
  readonly version?: string;
  readonly status?: string;
  readonly promotedAt?: string | null;
  readonly promotedBy?: string | null;
}

function adaptPrompt(raw: RawPromptRow): PromptRow {
  const status: PromptStatus =
    raw.status === 'canary'
      ? 'Canary'
      : raw.status === 'archived'
        ? 'Archived'
        : 'Production';
  const capability = raw.capability ?? 'unknown';
  return {
    id: raw.id ?? `${capability}_${raw.version ?? 'v0'}`,
    juniorId: `jr_${capability}`,
    junior: capability,
    version: raw.version ?? 'v0',
    gepaScore: 0,
    status,
    promotedAt: raw.promotedAt ?? new Date().toISOString(),
    body: '',
  };
}

export function usePromptsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PromptsResult> => {
      const res = await apiClient.get<ReadonlyArray<RawPromptRow>>('/prompts');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptPrompt), source: 'live' };
    },
  });
}

interface PromoteInput {
  readonly capability: string;
  readonly version: string;
}

/**
 * Promote a (capability, version) pair into canary. Wraps the live
 * `POST /promote` endpoint.
 */
export function usePromotePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PromoteInput): Promise<PromptRow> => {
      const res = await apiClient.post<RawPromptRow>('/prompts/promote', input);
      if (!res.ok) throw new Error(res.message);
      return adaptPrompt(res.data);
    },
    onSuccess: (row) => {
      const prev = qc.getQueryData<PromptsResult>(KEY);
      if (prev) {
        qc.setQueryData<PromptsResult>(KEY, {
          ...prev,
          rows: prev.rows.map((p) => (p.id === row.id ? row : p)),
        });
      } else {
        qc.invalidateQueries({ queryKey: KEY });
      }
    },
  });
}

interface SetStatusInput {
  readonly id: string;
  readonly status: PromptStatus;
}

/**
 * Legacy back-compat: forwards Canary transitions to `usePromotePrompt`
 * by resolving the (capability, version) pair from cache. Non-canary
 * transitions are not yet exposed by the gateway and will throw.
 */
export function useSetPromptStatus() {
  const qc = useQueryClient();
  const promote = usePromotePrompt();
  return useMutation({
    mutationFn: async ({ id, status }: SetStatusInput): Promise<PromptRow> => {
      if (status === 'Canary') {
        const cached = qc.getQueryData<PromptsResult>(KEY);
        const row = cached?.rows.find((p) => p.id === id);
        if (row) {
          const capability = row.juniorId.startsWith('jr_')
            ? row.juniorId.slice(3)
            : row.juniorId;
          return promote.mutateAsync({ capability, version: row.version });
        }
        throw new Error('Prompt row not found in cache; cannot promote');
      }
      throw new Error(
        `Prompt status transition '${status}' is not supported by the live gateway`,
      );
    },
  });
}
