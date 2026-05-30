/**
 * Superpower 1 — navigate.
 *
 * On the web this is a chip that calls `router.push(route)`. On mobile
 * we surface the same intent two ways: (a) a long-press contextual
 * menu, (b) the SearchFab pull-down. Both publish through
 * `navigateRequestBus` so screens can opt in without each one needing
 * to wire its own router.
 *
 * Workforce-mobile persona = worker. Allowed routes are filtered
 * client-side to "my tasks / my docs / my map" so the menu never
 * surfaces a manager-only screen.
 */
import { router } from 'expo-router'
import { navigateRequestBus, type NavigateRequestEvent } from './bus'

const WORKER_ALLOWED_PREFIXES: ReadonlyArray<string> = [
  '/(tabs)',
  '/(worker)',
  '/worker',
  '/photo-advisor',
  '/documents',
  '/notifications',
  '/onboarding'
]

export interface NavigateTarget {
  readonly route: string
  readonly label: string
  readonly params?: Readonly<Record<string, string>>
}

export function isWorkerAllowedRoute(route: string): boolean {
  return WORKER_ALLOWED_PREFIXES.some((p) => route === p || route.startsWith(`${p}/`) || route.startsWith(`${p}?`))
}

export function navigateToTarget(target: NavigateTarget): void {
  if (!isWorkerAllowedRoute(target.route)) {
    return
  }
  navigateRequestBus.publish({
    route: target.route,
    ...(target.params ? { params: target.params } : {})
  })
  try {
    // expo-router accepts a string OR a {pathname,params} object.
    if (target.params) {
      router.push({ pathname: target.route, params: target.params })
    } else {
      router.push(target.route)
    }
  } catch {
    // ignore navigation errors — bus subscribers can still react.
  }
}

export function subscribeNavigateRequest(handler: (e: NavigateRequestEvent) => void): () => void {
  return navigateRequestBus.subscribe(handler)
}

/**
 * Default targets a worker can jump to from the SearchFab / long-press
 * menu. Kept in code (rather than fetched) so the menu opens instantly
 * even when offline.
 */
export const DEFAULT_WORKER_TARGETS: ReadonlyArray<NavigateTarget> = [
  { route: '/(tabs)', label: 'Home' },
  { route: '/(worker)/tasks', label: 'My tasks' },
  { route: '/(worker)/safety', label: 'Safety check' },
  { route: '/photo-advisor', label: 'Photo advisor' },
  { route: '/notifications', label: 'Notifications' }
]
