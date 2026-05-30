/**
 * Superpower 8 — bookmark / pin parcel to watchlist (buyer persona).
 */
import { useCallback } from 'react'
import { apiFetch } from '@/api/client'
import { enqueueUndoToast } from './undo'
import { rememberRecentSearch } from './search'
import type { NavigateTarget } from './navigate'

interface PinApiResponse {
  readonly success: boolean
  readonly data?: { readonly pinnedItemId: string }
}

export interface BookmarkInput {
  readonly entityType: 'parcel' | 'rfb' | 'contract' | 'offer'
  readonly entityId: string
  readonly label: string
  readonly route: string
}

export function useBookmarkGesture(): (b: BookmarkInput) => Promise<void> {
  return useCallback(async (b) => {
    let pinnedId = ''
    try {
      const res = await apiFetch<PinApiResponse>('/api/v1/buyer/superpowers/pinned-items', {
        method: 'POST',
        body: {
          entityType: b.entityType,
          entityId: b.entityId,
          label: b.label,
          persona: 'buyer'
        }
      })
      if (res?.success && res.data?.pinnedItemId) {
        pinnedId = res.data.pinnedItemId
      }
    } catch {
      // optimistic
    }
    const target: NavigateTarget = { route: b.route, label: b.label }
    rememberRecentSearch(target)
    enqueueUndoToast({
      label: `Pinned ${b.label}`,
      journalIds: pinnedId ? [pinnedId] : [],
      windowSeconds: pinnedId ? 300 : 8
    })
  }, [])
}
