/**
 * Buyer-mobile live event stream — parity with owner-web cockpit-sse
 * and workforce-mobile event-stream. Foreground-only SSE consumer of
 * the api-gateway's /api/v1/cockpit/stream.
 *
 * When the app backgrounds we close the socket; out-of-app delivery
 * happens via push notifications (`device_push_tokens`).
 *
 * Buyer-relevant event kinds focus on the marketplace + RFB +
 * settlement chain. Other kinds (payroll, safety, etc.) are filtered
 * out so the in-memory ring doesn't fill with noise the buyer
 * cannot act on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import EventSourceImpl from 'react-native-sse'

import { apiConfig } from '@/api/config'
import { getAuthToken } from '@/auth/token'

export const BUYER_EVENT_KINDS = [
  'rfb.dispatched',
  'bid.placed',
  'settlement.initiated',
  'chat.handoff',
  'reminder.fired'
] as const

export type BuyerEventKind = (typeof BUYER_EVENT_KINDS)[number]

export interface BaseLiveEvent {
  readonly tenantId: string
  readonly emittedAt: string
}

export interface LiveEvent extends BaseLiveEvent {
  readonly kind: BuyerEventKind
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
  readonly onEvent?: (event: LiveEvent) => void
}

interface MutableESInstance {
  readonly addEventListener: (event: string, handler: (...args: unknown[]) => void) => void
  readonly removeAllEventListeners?: () => void
  readonly close: () => void
}

function parseEvent(raw: unknown): LiveEvent | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.kind !== 'string') return null
    if (!BUYER_EVENT_KINDS.includes(parsed.kind as BuyerEventKind)) {
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
 * Subscribe to the cockpit SSE stream for the buyer app. Returns
 * connection state + a bounded in-memory ring of the most recent events.
 */
export function useEventStream(
  options: UseEventStreamOptions = {}
): UseEventStreamState {
  const enabled = options.enabled ?? true
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
          // never crash the loop
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
      const url = `${apiConfig.baseUrl}/api/v1/cockpit/stream?role=buyer`
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
      for (const kind of BUYER_EVENT_KINDS) {
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
  }, [enabled, dispatchEvent, appActive])

  return useMemo(() => state, [state])
}
