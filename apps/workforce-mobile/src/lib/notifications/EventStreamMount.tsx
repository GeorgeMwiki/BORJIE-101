import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '../../auth/useAuth'

import { useEventStream } from './event-stream'
import {
  appendIncomingEvent,
  type WorkforceEventKind
} from './inbox-store'

/**
 * Mountable side-effect — opens the cockpit SSE socket while the app is
 * foregrounded and pipes every cross-actor event into the in-memory
 * inbox store so the notifications screen + any badge consumers stay
 * fresh in real time.
 *
 * Render-tree-free: returns null on every render. The hook is the
 * payload.
 */
export function EventStreamMount(): null {
  const { user } = useAuth()
  const role = useMemo<'owner' | 'manager' | 'worker'>(() => {
    if (user?.role === 'owner') return 'owner'
    if (user?.role === 'manager') return 'manager'
    return 'worker'
  }, [user?.role])

  // We never re-render — the state below is just used to bind a stable
  // callback into the hook for events.
  const [, setLastEventId] = useState<string>('')

  useEventStream({
    enabled: Boolean(user?.id),
    role,
    onEvent: (event) => {
      appendIncomingEvent({
        kind: event.kind as WorkforceEventKind,
        tenantId: event.tenantId,
        emittedAt: event.emittedAt,
        payload: event
      })
      setLastEventId(String(event.emittedAt))
    }
  })

  useEffect(() => {
    return () => undefined
  }, [])

  return null
}
