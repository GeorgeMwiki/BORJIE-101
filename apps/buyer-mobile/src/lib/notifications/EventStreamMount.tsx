import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useSession, isAuthenticated } from '@/auth/session'

import { useEventStream, type LiveEvent } from './event-stream'

/**
 * Mountable side-effect — opens the cockpit SSE socket while the app is
 * foregrounded. Renders nothing.
 *
 * SINGLE SOURCE OF TRUTH (SLICE TZ4): the pulse no longer feeds a
 * parallel in-memory inbox list with its own read-state (that list used
 * to diverge from the server record — a notification could read "read"
 * in one and "unread" in the other). On every pulse it ONLY invalidates
 * the PERSISTED `buyer_notifications` inbox queries (all + unread
 * variants share the `buyer-notifications` key prefix) so the
 * notifications screen + unread badge refetch from the authoritative
 * server record. The buyer channel carries the pulse; the persisted
 * inbox carries the truth.
 */
export function EventStreamMount(): null {
  const user = useSession()
  const queryClient = useQueryClient()

  const onEvent = useCallback(
    (_event: LiveEvent): void => {
      void queryClient.invalidateQueries({ queryKey: ['buyer-notifications'] })
    },
    [queryClient],
  )

  useEventStream({
    enabled: isAuthenticated() && user.id.length > 0,
    onEvent,
  })

  return null
}
