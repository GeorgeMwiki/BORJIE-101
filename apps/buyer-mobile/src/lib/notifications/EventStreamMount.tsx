import { useState } from 'react'

import { useSession, isAuthenticated } from '@/auth/session'

import { useEventStream } from './event-stream'
import { appendIncomingEvent } from './inbox-store'

/**
 * Mountable side-effect — opens the cockpit SSE socket while the app is
 * foregrounded and pipes every buyer-relevant event into the inbox store.
 * Renders nothing.
 */
export function EventStreamMount(): null {
  const user = useSession()
  const [, setLastEventId] = useState<string>('')

  useEventStream({
    enabled: isAuthenticated() && user.id.length > 0,
    onEvent: (event) => {
      appendIncomingEvent({
        kind: event.kind,
        tenantId: event.tenantId,
        emittedAt: event.emittedAt,
        payload: event
      })
      setLastEventId(String(event.emittedAt))
    }
  })

  return null
}
