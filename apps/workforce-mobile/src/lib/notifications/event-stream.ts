/**
 * Workforce-mobile live event stream — parity with owner-web cockpit-sse.
 *
 * Opens an EventSource (via `react-native-sse`) against the api-gateway's
 * /api/v1/cockpit/stream and surfaces the typed CockpitEvent stream to
 * any screen via `useEventStream()`. The mobile cockpit is foreground-
 * only — when the app backgrounds we close the SSE socket and rely on
 * push notifications (`device_push_tokens` registration above) to deliver
 * out-of-app alerts.
 *
 * Why react-native-sse and not the standard EventSource polyfill?
 *   - react-native-sse supports Authorization headers natively (the
 *     gateway's authMiddleware requires Bearer tokens; browser
 *     EventSource cannot set headers).
 *   - Bound to fetch under the hood so we inherit network stack
 *     timeouts and connectivity changes.
 *
 * Reconnect strategy:
 *   - Open while focused; close on AppState background.
 *   - Native auto-reconnect on transient network drop (handled by the
 *     library); we surface a `connected` flag so UIs can render a
 *     greyed-out status dot when the link is down.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
// `react-native-sse` is already a dependency (see package.json deps).
// The default export is a class compatible with the WHATWG EventSource API
// PLUS optional headers + reconnection options.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import EventSourceImpl from 'react-native-sse'

import { API_BASE_URL } from '../../api/config'
import { getAuthToken } from '../../api/session'

/**
 * Mirror of the api-gateway cockpit event kinds. Kept in lockstep with
 * `services/api-gateway/src/services/cockpit-events/types.ts` so the
 * types stay accurate without a runtime cross-package dependency.
 */
export const WORKFORCE_EVENT_KINDS = [
  'task.assigned',
  'manager.approved',
  'safety.incident_reported',
  'incident.escalated',
  'payroll.committed',
  'chat.handoff',
  'rfb.dispatched',
  'workforce.shift_event',
  'mwikila.acted',
  'mwikila.proposes',
  'reminder.fired'
] as const

export type WorkforceEventKind = (typeof WORKFORCE_EVENT_KINDS)[number]

export interface BaseLiveEvent {
  readonly tenantId: string
  readonly emittedAt: string
}

export interface LiveEvent extends BaseLiveEvent {
  readonly kind: WorkforceEventKind
  readonly [key: string]: unknown
}

export interface UseEventStreamState {
  readonly connected: boolean
  readonly events: ReadonlyArray<LiveEvent>
  readonly error: string | null
}

const INITIAL_STATE: UseEventStreamState = {
  connected: false,
  events: [],
  error: null
}

const MAX_EVENTS_IN_MEMORY = 100

export interface UseEventStreamOptions {
  readonly enabled?: boolean
  readonly role?: 'owner' | 'manager' | 'worker'
  readonly onEvent?: (event: LiveEvent) => void
}

interface MutableESInstance {
  readonly addEventListener: (event: string, handler: (...args: unknown[]) => void) => void
  readonly removeAllEventListeners: () => void
  readonly close: () => void
}

function parseEvent(raw: unknown): LiveEvent | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.kind !== 'string') return null
    if (!WORKFORCE_EVENT_KINDS.includes(parsed.kind as WorkforceEventKind)) {
      return null
    }
    if (typeof parsed.tenantId !== 'string' || parsed.tenantId.length === 0) {
      return null
    }
    if (typeof parsed.emittedAt !== 'string') return null
    return parsed as unknown as LiveEvent
  } catch {
    return null
  }
}

/**
 * Subscribe to the cockpit SSE stream for the workforce app. Returns
 * connection state + a bounded in-memory ring of the most recent events.
 *
 * Pass `onEvent` to flow each event into a toast or inbox refresh.
 */
export function useEventStream(
  options: UseEventStreamOptions = {}
): UseEventStreamState {
  const enabled = options.enabled ?? true
  const role = options.role ?? 'worker'
  const onEvent = options.onEvent
  const [state, setState] = useState<UseEventStreamState>(INITIAL_STATE)
  const sourceRef = useRef<MutableESInstance | null>(null)
  const [appActive, setAppActive] = useState<boolean>(() => AppState.currentState === 'active')

  useEffect(() => {
    const handler = (next: AppStateStatus): void => {
      setAppActive(next === 'active')
    }
    const sub = AppState.addEventListener('change', handler)
    return () => sub.remove()
  }, [])

  const dispatchEvent = useCallback(
    (event: LiveEvent): void => {
      setState((prev) => {
        const events = [...prev.events, event]
        if (events.length > MAX_EVENTS_IN_MEMORY) {
          events.splice(0, events.length - MAX_EVENTS_IN_MEMORY)
        }
        return { ...prev, connected: true, events, error: null }
      })
      if (onEvent) {
        try {
          onEvent(event)
        } catch {
          // Toast handler threw — never crash the SSE loop.
        }
      }
    },
    [onEvent]
  )

  useEffect(() => {
    if (!enabled || !appActive) {
      sourceRef.current?.close()
      sourceRef.current = null
      return undefined
    }

    let cancelled = false

    async function open(): Promise<void> {
      const token = await getAuthToken()
      if (cancelled || !token) {
        if (!token) {
          setState((prev) => ({ ...prev, connected: false, error: 'no_token' }))
        }
        return
      }
      const url = `${API_BASE_URL}/api/v1/cockpit/stream?role=${encodeURIComponent(role)}`
      let source: MutableESInstance
      try {
        source = new (EventSourceImpl as unknown as new (
          url: string,
          init: { headers: Record<string, string>; pollingInterval?: number }
        ) => MutableESInstance)(url, {
          headers: { Authorization: `Bearer ${token}` },
          pollingInterval: 0
        })
      } catch (err) {
        setState({
          connected: false,
          events: [],
          error: err instanceof Error ? err.message : 'eventsource_construct_failed'
        })
        return
      }
      sourceRef.current = source

      source.addEventListener('open', () => {
        if (cancelled) return
        setState((prev) => ({ ...prev, connected: true, error: null }))
      })
      source.addEventListener('connected', () => {
        if (cancelled) return
        setState((prev) => ({ ...prev, connected: true, error: null }))
      })
      for (const kind of WORKFORCE_EVENT_KINDS) {
        source.addEventListener(kind, (...args: unknown[]) => {
          if (cancelled) return
          const raw = (args[0] as { data?: unknown } | undefined)?.data
          const event = parseEvent(raw)
          if (event) dispatchEvent(event)
        })
      }
      source.addEventListener('error', (...args: unknown[]) => {
        if (cancelled) return
        const message = (args[0] as { message?: string } | undefined)?.message ?? 'sse_error'
        setState((prev) => ({ ...prev, connected: false, error: message }))
      })
    }

    void open()

    return () => {
      cancelled = true
      sourceRef.current?.removeAllEventListeners?.()
      sourceRef.current?.close()
      sourceRef.current = null
    }
  }, [enabled, role, dispatchEvent, appActive])

  return useMemo(() => state, [state])
}
