'use client';

/**
 * useEscalations — load + close-out state for the owner-web escalations
 * panel.
 *
 * Reads the authoritative `mining_escalations` ladder through the mounted
 * gateway GET, and drives the acknowledge / resolve closing transitions
 * with an OPTIMISTIC patch + authoritative refetch. The optimistic update
 * is immutable (new array, new row object); a failed call refetches to
 * reconcile, never leaving a torn local state.
 *
 * Owner-web-native re-implementation of the superseded
 * `src/features/central-command` port hook.
 *
 * @module lib/useEscalations
 */

import { useCallback, useEffect, useState } from 'react';
import {
  acknowledgeEscalation,
  fetchOpenEscalations,
  resolveEscalation,
  type MiningEscalationRow,
} from './escalations-client';

export type EscalationAction = 'acknowledge' | 'resolve';

export interface UseEscalationsResult {
  readonly rows: ReadonlyArray<MiningEscalationRow>;
  readonly isLoading: boolean;
  readonly loadError: boolean;
  readonly actionError: boolean;
  readonly pendingId: string | null;
  readonly pendingAction: EscalationAction | null;
  readonly act: (id: string, action: EscalationAction) => void;
}

export function useEscalations(enabled: boolean): UseEscalationsResult {
  const [rows, setRows] = useState<ReadonlyArray<MiningEscalationRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [actionError, setActionError] = useState<boolean>(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<EscalationAction | null>(
    null,
  );

  const load = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setLoadError(false);
    try {
      const next = await fetchOpenEscalations(signal);
      if (!signal?.aborted) setRows(next);
    } catch {
      if (!signal?.aborted) setLoadError(true);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [enabled, load]);

  const act = useCallback(
    (id: string, action: EscalationAction): void => {
      if (pendingId) return; // serialize: one transition at a time
      setActionError(false);
      setPendingId(id);
      setPendingAction(action);
      // Optimistic + immutable: resolve drops the row from the active
      // list; acknowledge transitions it in-place to `acknowledged`.
      setRows((prev) =>
        action === 'resolve'
          ? prev.filter((r) => r.id !== id)
          : prev.map((r) =>
              r.id === id ? { ...r, status: 'acknowledged' as const } : r,
            ),
      );
      const call =
        action === 'acknowledge' ? acknowledgeEscalation : resolveEscalation;
      void call(id)
        .catch(() => setActionError(true))
        .finally(() => {
          setPendingId(null);
          setPendingAction(null);
          void load(); // reconcile against the authoritative table
        });
    },
    [pendingId, load],
  );

  return {
    rows,
    isLoading,
    loadError,
    actionError,
    pendingId,
    pendingAction,
    act,
  };
}
