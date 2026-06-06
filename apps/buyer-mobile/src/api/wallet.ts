import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import type { WalletSnapshot } from '@/marketplace/WalletBar'

interface WalletResponse {
  readonly data: WalletSnapshot
}

/**
 * Fetch the buyer's real wallet snapshot from the gateway.
 *
 * GATEWAY-DEPENDENT: `GET /api/v1/mining/buyers/wallet` may not exist yet.
 * When it 404s the caller (marketplace screen) HIDES the wallet bar rather
 * than render fabricated zero balances. The response shape mirrors
 * `WalletSnapshot` — balances + display-only FX rates pinned by the
 * gateway (never converted client-side).
 */
export async function fetchWallet(signal?: AbortSignal): Promise<WalletSnapshot> {
  const response = await apiFetch<WalletResponse>(`${MINING_PREFIX}/buyers/wallet`, {
    ...(signal ? { signal } : {})
  })
  return response.data
}
