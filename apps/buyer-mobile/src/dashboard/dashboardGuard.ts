import type { BuyerUser } from '@/types/auth'

/**
 * Pure routing guard for the Dashibodi tab. The buyer-mobile session model
 * has no cross-tenant scenario in the app shell — the Supabase JWT binds
 * `app.current_tenant_id` server-side — but we still verify locally that
 * the active session belongs to the expected tenant (the one bound to the
 * pre-fetched dashboard data). If the tenant changes underneath us (token
 * refresh on a different account, or a stale cache after sign-out), the
 * guard returns a redirect target so the screen can bail out to /auth.
 */

export type DashboardGuardOutcome =
  | { readonly kind: 'allow' }
  | { readonly kind: 'redirect'; readonly to: string }

export interface DashboardGuardInput {
  readonly user: BuyerUser
  readonly expectedTenantId: string | null
  readonly currentTenantId: string | null
}

export function evaluateDashboardGuard(input: DashboardGuardInput): DashboardGuardOutcome {
  if (!input.user.id) {
    return { kind: 'redirect', to: '/auth/login' }
  }
  if (
    input.expectedTenantId !== null &&
    input.currentTenantId !== null &&
    input.expectedTenantId !== input.currentTenantId
  ) {
    return { kind: 'redirect', to: '/auth/login' }
  }
  return { kind: 'allow' }
}
