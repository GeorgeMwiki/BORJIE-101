/**
 * react-query bindings for /api/v1/mining/internal/killswitch.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/killswitch.hono.ts):
 *   POST  /     set kill-switch state for a scope ({platform | tenant:<id>})
 *
 * NOTE: the gateway does not expose a list endpoint yet — the
 * per-junior view stays mock-only (TODO: add `GET /` to the route once
 * the platform_killswitch_state schema supports junior-grained queries).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { MOCK_KILLSWITCH } from '@/lib/mocks/killswitch';
import type { KillswitchRow, SwitchState } from '@/lib/mocks/types';

const KEY = ['internal', 'killswitch'] as const;

interface KillswitchResult {
  readonly rows: ReadonlyArray<KillswitchRow>;
  readonly source: 'live' | 'mock';
}

/** TODO: replace with live GET when gateway exposes one. */
export function useKillswitchQuery() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<KillswitchResult> => {
      // Always falls back: there is no list endpoint upstream yet.
      return { rows: MOCK_KILLSWITCH, source: 'mock' };
    },
  });
}

interface SetStateInput {
  readonly juniorId: string;
  readonly state: SwitchState;
  readonly firstOperatorId: string;
  readonly secondOperatorId: string;
  readonly reasonCode?: string;
  readonly note?: string;
}

function levelFromState(state: SwitchState): 'live' | 'degraded' | 'halt' {
  if (state === 'OK') return 'live';
  if (state === 'DEGRADED') return 'degraded';
  return 'halt';
}

function scopeForJunior(juniorId: string): string {
  // Until the live API understands per-junior scopes we map the special
  // `global` row to the platform-wide kill, and every other row to a
  // tenant-scoped placeholder. The UI is unchanged.
  return juniorId === 'global' ? 'platform' : `tenant:${juniorId}`;
}

export function useSetKillswitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetStateInput): Promise<KillswitchRow> => {
      const res = await apiClient.post<KillswitchRow>(
        '/killswitch',
        {
          scope: scopeForJunior(input.juniorId),
          level: levelFromState(input.state),
          reasonCode: input.reasonCode ?? 'operator.manual',
          note: input.note,
        },
        async () => {
          const hit = MOCK_KILLSWITCH.find((k) => k.juniorId === input.juniorId);
          return {
            juniorId: input.juniorId,
            junior: hit?.junior ?? input.juniorId,
            state: input.state,
            updatedAt: new Date().toISOString(),
            updatedBy: `${input.firstOperatorId}+${input.secondOperatorId}`,
          };
        },
        // X-Confirmation-Operator-Id header satisfies the gateway's
        // four-eye policy on the live route.
        { 'X-Confirmation-Operator-Id': input.secondOperatorId },
      );
      if (!res.ok) throw new Error(res.message);
      // Live responses use the platform_killswitch_state shape; coerce
      // back into the front-end's KillswitchRow.
      if (res.source === 'live') {
        return {
          juniorId: input.juniorId,
          junior:
            MOCK_KILLSWITCH.find((k) => k.juniorId === input.juniorId)?.junior ?? input.juniorId,
          state: input.state,
          updatedAt: new Date().toISOString(),
          updatedBy: `${input.firstOperatorId}+${input.secondOperatorId}`,
        };
      }
      return res.data;
    },
    onSuccess: (next) => {
      const prev = qc.getQueryData<KillswitchResult>(KEY);
      if (prev) {
        qc.setQueryData<KillswitchResult>(KEY, {
          ...prev,
          rows: prev.rows.map((r) => (r.juniorId === next.juniorId ? next : r)),
        });
      } else {
        qc.invalidateQueries({ queryKey: KEY });
      }
    },
  });
}
