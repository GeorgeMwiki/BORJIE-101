/**
 * In-module pub/sub bus for buyer-mobile superpowers events. Same
 * shape as workforce-mobile so a future shared package can replace
 * this verbatim.
 */
export type Handler<T> = (payload: T) => void

interface Bus<T> {
  publish: (payload: T) => void
  subscribe: (handler: Handler<T>) => () => void
}

function createBus<T>(): Bus<T> {
  const handlers: Set<Handler<T>> = new Set()
  return {
    publish(payload) {
      for (const h of handlers) {
        try {
          h(payload)
        } catch {
          // ignore handler errors
        }
      }
    },
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    }
  }
}

export interface FormPrefillEvent {
  readonly formId: string
  readonly values: Readonly<Record<string, unknown>>
  readonly submitOnAccept?: boolean
}

export interface HighlightEvent {
  readonly target: string
  readonly tone?: 'info' | 'success' | 'warning' | 'critical'
  readonly ttlMs?: number
}

export interface UndoToastEvent {
  readonly id: string
  readonly label: string
  readonly journalIds: ReadonlyArray<string>
  readonly windowSeconds?: number
}

export interface NavigateRequestEvent {
  readonly route: string
  readonly params?: Readonly<Record<string, string>>
}

export interface BulkActionEvent {
  readonly entityType: string
  readonly ids: ReadonlyArray<string>
  readonly action: string
}

export const formPrefillBus = createBus<FormPrefillEvent>()
export const highlightBus = createBus<HighlightEvent>()
export const undoToastBus = createBus<UndoToastEvent>()
export const navigateRequestBus = createBus<NavigateRequestEvent>()
export const bulkActionBus = createBus<BulkActionEvent>()
