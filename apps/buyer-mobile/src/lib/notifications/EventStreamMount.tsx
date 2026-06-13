import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useSession, isAuthenticated } from '@/auth/session'

import { useEventStream, type LiveEvent } from './event-stream'
import { appendIncomingEvent } from './inbox-store'

/**
 * Mountable side-effect — opens the cockpit SSE socket while the app is
 * foregrounded and pipes every buyer-relevant event into the inbox store.
 * Renders nothing.
 *
 * On every pulse it also invalidates the PERSISTED `buyer_notifications`
 * inbox queries (react-query) so the Live ribbon + the notifications list
 * refresh from the authoritative server record rather than diverging into
 * an in-memory-only list. This is the SLICE B2 fix: the buyer channel
 * carries the pulse, the persisted inbox carries the truth.
 */
export function EventStreamMount(): null {
  const user = useSession()
  const queryClient = useQueryClient()
  const [, setLastEventId] = useState<string>('')

  const onEvent = useCallback(
    (event: LiveEvent): void => {
      appendIncomingEvent({
        kind: event.kind,
        tenantId: event.tenantId,
        emittedAt: event.emittedAt,
        payload: event
      })
      setLastEventId(String(event.emittedAt))
      // Refresh the persisted buyer-notifications inbox (all + unread
      // variants share the `buyer-notifications` key prefix) so the
      // ribbon/list reflect the server record on the next pulse.
      void queryClient.invalidateQueries({ queryKey: ['buyer-notifications'] })
    },
    [queryClient]
  )

  useEventStream({
    enabled: isAuthenticated() && user.id.length > 0,
    onEvent
  })

  return null
}
