/**
 * Superpower 5 — bulk.
 *
 * Mobile list multi-select. Toggle items via long-press; the
 * SuperpowersBootstrap mounts a sticky chip + action sheet when the
 * selection is non-empty. Workforce persona = worker, so the allowed
 * action set is intentionally narrow (acknowledge / mark-done).
 */
import { useCallback, useEffect, useState } from 'react'
import { bulkActionBus } from './bus'
import { miningApi } from '../api/client'
import { enqueueUndoToast } from './undo'

export type WorkerBulkAction = 'acknowledge' | 'mark_done'

export interface BulkSelection {
  readonly entityType: string
  readonly ids: ReadonlyArray<string>
  readonly toggle: (id: string) => void
  readonly clear: () => void
  readonly isSelected: (id: string) => boolean
  readonly count: number
}

let liveSelection: { entityType: string; ids: ReadonlyArray<string> } | null = null

export function getLiveBulkSelection(): { entityType: string; ids: ReadonlyArray<string> } | null {
  return liveSelection
}

/**
 * List-screen helper. Returns immutable selection state + a toggle.
 * Calls publish() on every change so the bootstrap's chip mount knows
 * to render / hide.
 */
export function useBulkSelection(entityType: string): BulkSelection {
  const [ids, setIds] = useState<ReadonlyArray<string>>([])

  const toggle = useCallback((id: string) => {
    setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const clear = useCallback(() => setIds([]), [])

  const isSelected = useCallback((id: string) => ids.includes(id), [ids])

  useEffect(() => {
    liveSelection = ids.length > 0 ? { entityType, ids } : null
    bulkActionBus.publish({ entityType, ids, action: 'selection_changed' })
    return () => {
      if (liveSelection?.entityType === entityType) {
        liveSelection = null
      }
    }
  }, [entityType, ids])

  return { entityType, ids, toggle, clear, isSelected, count: ids.length }
}

interface BulkApiResponse {
  readonly success: boolean
  readonly data?: { readonly undoJournalIds?: ReadonlyArray<string> }
}

/**
 * Workforce-persona-safe wrapper for /superpowers/bulk-action. Returns
 * the undo-journal id list so the bootstrap can stage an undo toast.
 */
export async function runWorkerBulkAction(
  entityType: string,
  ids: ReadonlyArray<string>,
  action: WorkerBulkAction,
  label: string
): Promise<ReadonlyArray<string>> {
  if (ids.length === 0) {
    return []
  }
  let undoJournalIds: ReadonlyArray<string> = []
  try {
    const res = await miningApi.post<BulkApiResponse>('/superpowers/bulk-action', {
      entityType,
      ids,
      action,
      persona: 'worker',
      reason: `worker-bulk-${action}`
    })
    if (res?.success && res.data?.undoJournalIds) {
      undoJournalIds = res.data.undoJournalIds
    }
  } catch {
    // surface a no-op undo toast so the user still sees the bulk attempt
  }
  enqueueUndoToast({
    label,
    journalIds: undoJournalIds,
    windowSeconds: undoJournalIds.length > 0 ? 300 : 8
  })
  return undoJournalIds
}
