/**
 * react-query bindings for /api/v1/mining/internal/killswitch.
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/killswitch.hono.ts):
 *   GET   /                    list active kill-switch state per scope
 *   POST  /                    initiate kill-switch change (two-operator RBAC)
 *   POST  /:id/confirm         second operator confirms; fires the switch
 *   GET   /pending             list pending confirmations actionable by caller
 *
 * The legacy single-shot `useSetKillswitch` is replaced by the
 * initiate -> confirm flow (issue #24). Live-only: failures propagate
 * to react-query's `error` channel.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { KillswitchRow, SwitchState } from '@/lib/internal/types';

const ROWS_KEY = ['internal', 'killswitch', 'rows'] as const;
const PENDING_KEY = ['internal', 'killswitch', 'pending'] as const;

interface KillswitchResult {
  readonly rows: ReadonlyArray<KillswitchRow>;
  readonly source: 'live';
}

interface RawKillswitchRow {
  readonly id?: string;
  readonly scope?: string;
  readonly level?: 'live' | 'degraded' | 'halt';
  readonly setAt?: string;
  readonly setBy?: string;
}

function stateFromLevel(level: RawKillswitchRow['level']): SwitchState {
  if (level === 'live') return 'OK';
  if (level === 'degraded') return 'DEGRADED';
  return 'HALT';
}

function adaptKillswitch(raw: RawKillswitchRow): KillswitchRow {
  const scope = raw.scope ?? 'platform';
  const juniorId = scope === 'platform' ? 'global' : scope.replace(/^tenant:/, '');
  return {
    juniorId,
    junior: juniorId,
    state: stateFromLevel(raw.level),
    updatedAt: raw.setAt ?? new Date().toISOString(),
    updatedBy: raw.setBy ?? 'system',
  };
}

export function useKillswitchQuery() {
  return useQuery({
    queryKey: ROWS_KEY,
    queryFn: async (): Promise<KillswitchResult> => {
      const res = await apiClient.get<ReadonlyArray<RawKillswitchRow>>('/killswitch');
      if (!res.ok) throw new Error(res.message);
      return { rows: res.data.map(adaptKillswitch), source: 'live' };
    },
  });
}

// ----------------------------------------------------------------------------
// Two-operator flow — issue #24 hardening
// ----------------------------------------------------------------------------

export interface PendingTarget {
  readonly scope: string;
  readonly level: 'live' | 'degraded' | 'halt';
  readonly reasonCode: string;
  readonly note?: string;
}

export interface PendingConfirmation {
  readonly id: string;
  readonly killswitchTarget: PendingTarget;
  readonly initiatorUserId: string;
  readonly initiatedAt: string;
  readonly expiresAt: string;
}

export interface InitiateResponse {
  readonly pendingConfirmationId: string;
  readonly target: PendingTarget;
  readonly expiresAt: string;
  readonly waitingForSecondOperator: boolean;
}

interface InitiateInput {
  readonly juniorId: string;
  readonly state: SwitchState;
  readonly reasonCode?: string;
  readonly note?: string;
}

function levelFromState(state: SwitchState): 'live' | 'degraded' | 'halt' {
  if (state === 'OK') return 'live';
  if (state === 'DEGRADED') return 'degraded';
  return 'halt';
}

function scopeForJunior(juniorId: string): string {
  return juniorId === 'global' ? 'platform' : `tenant:${juniorId}`;
}

/**
 * Initiate a two-operator kill switch. Returns the pending-confirmation
 * id; the UI surfaces it and starts polling /pending so the second
 * operator can confirm within 30s.
 */
export function useInitiateKillswitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InitiateInput): Promise<InitiateResponse> => {
      const res = await apiClient.post<InitiateResponse>('/killswitch', {
        scope: scopeForJunior(input.juniorId),
        level: levelFromState(input.state),
        reasonCode: input.reasonCode ?? 'operator.manual',
        note: input.note,
      });
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PENDING_KEY });
    },
  });
}

/**
 * Confirm a pending kill switch as the second operator. The gateway
 * verifies caller != initiator AND both users hold matching authorities.
 */
export function useConfirmKillswitch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (pendingId: string): Promise<{ readonly id: string }> => {
      const res = await apiClient.post<{ readonly id: string }>(
        `/killswitch/${encodeURIComponent(pendingId)}/confirm`,
        {},
      );
      if (!res.ok) throw new Error(res.message);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PENDING_KEY });
      qc.invalidateQueries({ queryKey: ROWS_KEY });
    },
  });
}

/**
 * Poll for pending confirmations actionable by the current admin. The
 * gateway hides rows the caller initiated so the same operator cannot
 * approve themselves.
 */
export function usePendingConfirmations(pollMs = 5_000) {
  return useQuery({
    queryKey: PENDING_KEY,
    queryFn: async (): Promise<ReadonlyArray<PendingConfirmation>> => {
      const res = await apiClient.get<ReadonlyArray<PendingConfirmation>>(
        '/killswitch/pending',
      );
      if (!res.ok) return [];
      return res.data;
    },
    refetchInterval: pollMs,
  });
}
