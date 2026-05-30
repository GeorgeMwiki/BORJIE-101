/**
 * Superpower 8 — bookmark / pin.
 *
 * Long-press gesture wrapper for list items. Pin survives via the
 * /pinned-items endpoint and surfaces in the SearchFab recents.
 */
import { useCallback } from 'react'
import { miningApi } from '../api/client'
import { enqueueUndoToast } from './undo'
import { rememberRecentSearch } from './search'
import type { NavigateTarget } from './navigate'

interface PinApiResponse {
  readonly success: boolean
  readonly data?: { readonly pinnedItemId: string }
}

export interface BookmarkInput {
  readonly entityType: string
  readonly entityId: string
  readonly label: string
  readonly route: string
}

/**
 * Returns a stable callback to wire into <Pressable onLongPress>.
 * After a successful pin we both seed the recents cache (so SearchFab
 * shows it) and queue an undo toast.
 */
export function useBookmarkGesture(): (b: BookmarkInput) => Promise<void> {
  return useCallback(async (b) => {
    let pinnedId = ''
    try {
      const res = await miningApi.post<PinApiResponse>('/superpowers/pinned-items', {
        entityType: b.entityType,
        entityId: b.entityId,
        label: b.label,
        persona: 'worker'
      })
      if (res?.success && res.data?.pinnedItemId) {
        pinnedId = res.data.pinnedItemId
      }
    } catch {
      // optimistic — keep the pin local even if the network call failed
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
