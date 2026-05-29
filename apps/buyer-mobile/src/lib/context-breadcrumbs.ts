/**
 * Context breadcrumbs (K-D) — buyer-mobile.
 *
 * Mobile equivalent of apps/owner-web/src/lib/context-breadcrumbs.ts.
 * Same wire payload + same serializer so the brain side reads one
 * shape regardless of the originating client. Buyer mobile narrows
 * via crumbs like:
 *
 *   Search "cobalt" → Listing "Mwadui 50t" → Counterparty "Borjie Op"
 */

export interface ContextCrumb {
  readonly kind: string
  readonly id: string
  readonly label: string
  readonly scopeId?: string
}

export interface ContextStackPayload {
  readonly stack: ReadonlyArray<{
    readonly kind: string
    readonly id: string
    readonly label: string
    readonly scopeId?: string
  }>
}

const MAX_STACK = 8

export function pushCrumb(
  stack: ReadonlyArray<ContextCrumb>,
  crumb: ContextCrumb,
): ReadonlyArray<ContextCrumb> {
  const trimmed = stack.length >= MAX_STACK ? stack.slice(1) : stack.slice()
  trimmed.push(Object.freeze({ ...crumb }))
  return Object.freeze(trimmed)
}

export function popCrumb(
  stack: ReadonlyArray<ContextCrumb>,
): ReadonlyArray<ContextCrumb> {
  if (stack.length === 0) return stack
  return Object.freeze(stack.slice(0, -1))
}

export function replaceStack(
  stack: ReadonlyArray<ContextCrumb>,
): ReadonlyArray<ContextCrumb> {
  return Object.freeze(stack.slice(-MAX_STACK).map((c) => Object.freeze({ ...c })))
}

export function serializeCrumbStack(
  stack: ReadonlyArray<ContextCrumb>,
): string | null {
  if (stack.length === 0) return null
  return stack.map((c) => c.label).join(' → ')
}

export function toWirePayload(
  stack: ReadonlyArray<ContextCrumb>,
): ContextStackPayload {
  return Object.freeze({
    stack: Object.freeze(
      stack.map((c) =>
        Object.freeze({
          kind: c.kind,
          id: c.id,
          label: c.label,
          ...(c.scopeId !== undefined && { scopeId: c.scopeId }),
        }),
      ),
    ),
  })
}
