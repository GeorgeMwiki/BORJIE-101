/**
 * Superpower 1 — navigate (buyer persona).
 *
 * Allowed routes are the buyer-facing surfaces only. Owner-cockpit
 * / admin surfaces never appear in the search FAB even if the server
 * accidentally returns them.
 */
import { router } from 'expo-router'
import { navigateRequestBus, type NavigateRequestEvent } from './bus'

const BUYER_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  '/(tabs)',
  '/marketplace',
  '/bids',
  '/rfb',
  '/documents',
  '/documents-intel',
  '/chat',
  '/kyc',
  '/profile',
  '/notifications'
]

export interface NavigateTarget {
  readonly route: string
  readonly label: string
  readonly params?: Readonly<Record<string, string>>
}

export function isBuyerAllowedRoute(route: string): boolean {
  return BUYER_ALLOWED_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`) || route.startsWith(`${p}?`))
}

export function navigateToTarget(target: NavigateTarget): void {
  if (!isBuyerAllowedRoute(target.route)) {
    return
  }
  navigateRequestBus.publish({
    route: target.route,
    ...(target.params ? { params: target.params } : {})
  })
  try {
    if (target.params) {
      router.push({ pathname: target.route, params: target.params })
    } else {
      router.push(target.route)
    }
  } catch {
    // ignore — subscribers can still react
  }
}

export function subscribeNavigateRequest(handler: (e: NavigateRequestEvent) => void): () => void {
  return navigateRequestBus.subscribe(handler)
}

export const DEFAULT_BUYER_TARGETS: ReadonlyArray<NavigateTarget> = [
  { route: '/(tabs)', label: 'Home' },
  { route: '/marketplace', label: 'Marketplace' },
  { route: '/rfb', label: 'Request for Bids' },
  { route: '/bids', label: 'My bids' },
  { route: '/documents', label: 'Contracts' },
  { route: '/chat', label: 'Chat' }
]
