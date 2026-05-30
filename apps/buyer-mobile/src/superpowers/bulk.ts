/**
 * Superpower 5 — bulk RFB.
 *
 * Buyer persona allowed actions: bulk_rfb (request bids on N parcels)
 * and bulk_watch (pin to watchlist). Anything else is rejected
 * server-side via the persona guard.
 */
import { useCallback, useEffect, useState } from 'react'
import { bulkActionBus } from './bus'
import { apiFetch } from '@/api/client'
import { enqueueUndoToast } from './undo'

export type BuyerBulkAction = 'bulk_rfb' | 'bulk_watch'

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

export async function runBuyerBulkAction(
  entityType: string,
  ids: ReadonlyArray<string>,
  action: BuyerBulkAction,
  label: string
): Promise<ReadonlyArray<string>> {
  if (ids.length === 0) {
    return []
  }
  let undoJournalIds: ReadonlyArray<string> = []
  try {
    const res = await apiFetch<BulkApiResponse>('/api/v1/buyer/superpowers/bulk-action', {
      method: 'POST',
      body: {
        entityType,
        ids,
        action,
        persona: 'buyer',
        reason: `buyer-bulk-${action}`
      }
    })
    if (res?.success && res.data?.undoJournalIds) {
      undoJournalIds = res.data.undoJournalIds
    }
  } catch {
    // ignore — still show a no-op undo toast so the action is visible
  }
  enqueueUndoToast({
    label,
    journalIds: undoJournalIds,
    windowSeconds: undoJournalIds.length > 0 ? 300 : 8
  })
  return undoJournalIds
}
