/**
 * Superpower 6 — undo.
 *
 * Toast queue + 24h server-side window. When the user taps "Undo" we
 * POST /superpowers/undo-journal/undo-last with the journal id list
 * we received from the destructive call. The bootstrap renders the
 * toast itself; this module owns the enqueue API.
 */
import { undoToastBus, type UndoToastEvent } from './bus'
import { miningApi } from '../api/client'

interface UndoApiResponse {
  readonly success: boolean
}

export function enqueueUndoToast(input: Omit<UndoToastEvent, 'id'>): void {
  undoToastBus.publish({ ...input, id: `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
}

export async function undoJournalIds(ids: ReadonlyArray<string>): Promise<boolean> {
  if (ids.length === 0) return false
  try {
    const res = await miningApi.post<UndoApiResponse>('/superpowers/undo-journal/undo-last', {
      journalIds: ids,
      reason: 'user-tapped-undo-toast'
    })
    return Boolean(res?.success)
  } catch {
    return false
  }
}
