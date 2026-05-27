/**
 * Lightweight JWT claim parser for buyer-mobile — base64-decodes the middle
 * segment of a Supabase access token to extract the `phone` claim and the
 * Borjie-domain custom claims (`app_metadata.tenant_id`).
 *
 * Signature verification happens server-side in api-gateway
 * (`services/api-gateway/src/auth/supabase/supabase-jwt-verify.ts`), so an
 * unsigned parse on the client is safe — we only use the claims for UI
 * routing, never for authorisation.
 */

export interface BuyerTokenClaims {
  readonly userId: string
  readonly tenantId: string | null
  readonly phone: string | null
}

interface RawJwtPayload {
  readonly sub?: string
  readonly phone?: string
  readonly app_metadata?: {
    readonly tenant_id?: string
  }
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (padded.length % 4)) % 4
  const normalised = padded + '='.repeat(padding)
  if (typeof atob === 'function') {
    return atob(normalised)
  }
  const g = globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } } }
  if (g.Buffer) {
    return g.Buffer.from(normalised, 'base64').toString('utf-8')
  }
  throw new Error('No base64 decoder available in this runtime')
}

export function parseSupabaseTokenForBuyer(accessToken: string): BuyerTokenClaims | null {
  if (!accessToken || typeof accessToken !== 'string') return null
  const segments = accessToken.split('.')
  if (segments.length !== 3) return null
  const middle = segments[1]
  if (!middle) return null

  try {
    const decoded = base64UrlDecode(middle)
    const payload = JSON.parse(decoded) as RawJwtPayload
    const appMd = payload.app_metadata ?? {}
    return {
      userId: payload.sub ?? '',
      tenantId: appMd.tenant_id ?? null,
      phone: payload.phone ?? null
    }
  } catch {
    return null
  }
}
