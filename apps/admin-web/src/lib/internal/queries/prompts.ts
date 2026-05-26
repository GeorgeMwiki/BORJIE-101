/**
 * react-query bindings for /api/v1/mining/internal/prompts.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/prompts.hono.ts):
 *   GET   /              list prompt registry rows
 *   POST  /promote       promote (capability, version) → canary
 *
 * The legacy `useSetPromptStatus` mutation predates the live API and
 * mapped to a PATCH on `/prompts/:id/status` that does not exist; it is
 * retained for back-compat but now translates `status === 'Canary'`
 * into a `/promote` call, otherwise stays mock-only.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_PROMPTS } from '@/lib/mocks/prompts';
import type { PromptRow, PromptStatus } from '@/lib/mocks/types';

const KEY = ['internal', 'prompts'] as const;

interface PromptsResult {
  readonly rows: ReadonlyArray<PromptRow>;
  readonly source: 'live' | 'mock';
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

interface RawPromoteResult extends RawPromptRow {}

export function usePromptsQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<PromptsResult> => {
      const res = await apiClient.get<ReadonlyArray<RawPromptRow | PromptRow>>(
        '/prompts',
        async () => MOCK_PROMPTS,
      );
      if (!res.ok) throw new Error(res.message);
      const rows =
        res.source === 'live'
          ? (res.data as ReadonlyArray<RawPromptRow>).map(adaptPrompt)
          : (res.data as ReadonlyArray<PromptRow>);
      return { rows, source: res.source };
    },
  });
}

interface PromoteInput {
  readonly capability: string;
  readonly version: string;
}

/**
 * Promote a (capability, version) pair into canary. Wraps the live
 * `POST /promote` endpoint. Falls back to mock-list mutation when the
 * gateway is unreachable.
 */
export function usePromotePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PromoteInput): Promise<PromptRow> => {
      const res = await apiClient.post<RawPromptRow | PromptRow>(
        '/prompts/promote',
        input,
        async () => {
          // PromptRow uses `juniorId/junior` (no `capability`). The legacy
          // mock stores capability as `jr_<capability>`; mirror that here
          // so the lookup behaves the same online and offline.
          const wantJunior = `jr_${input.capability}`;
          const hit = MOCK_PROMPTS.find(
            (p) => p.juniorId === wantJunior && p.version === input.version,
          );
          if (!hit) throw new Error('Prompt not found');
          return { ...hit, status: 'Canary', promotedAt: new Date().toISOString() };
        },
      );
      if (!res.ok) throw new Error(res.message);
      return res.source === 'live'
        ? adaptPrompt(res.data as RawPromptRow)
        : (res.data as PromptRow);
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
 * Legacy back-compat: existing UI passes `{id, status}` straight from a
 * dropdown. When the target is `Canary` and we can resolve the row's
 * (capability, version) from cache, we forward to the live promote
 * endpoint; everything else stays mock-only (TODO: extend gateway).
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
      }
      // TODO: gateway does not expose status-set for non-canary transitions yet.
      const hit = MOCK_PROMPTS.find((p) => p.id === id);
      if (!hit) throw new Error('Prompt not found');
      return { ...hit, status, promotedAt: new Date().toISOString() };
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData<PromptsResult>(KEY);
      if (prev) {
        qc.setQueryData<PromptsResult>(KEY, {
          ...prev,
          rows: prev.rows.map((p) => (p.id === id ? { ...p, status } : p)),
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
