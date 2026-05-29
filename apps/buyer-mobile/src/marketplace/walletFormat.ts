/**
 * walletFormat — pure money formatter for the marketplace WalletBar.
 *
 * Borjie hard rule: every money render uses currency-aware formatting,
 * never hard-coded "TZS". We keep this scoped to the three currencies
 * the buyer marketplace touches (TZS primary, USD + KES secondary).
 *
 * Domestic non-TZS contracts are rejected at the API layer; this
 * formatter is display-only for the buyer's own wallet.
 */

export type WalletCurrency = 'TZS' | 'USD' | 'KES'

export function formatWalletAmount(amount: number, currency: WalletCurrency): string {
  const safe = Number.isFinite(amount) ? amount : 0
  switch (currency) {
    case 'TZS':
      return `TZS ${formatScale(safe)}`
    case 'USD':
      return `USD ${formatScale(safe)}`
    case 'KES':
      return `KSh ${formatScale(safe)}`
  }
}

function formatScale(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `${(amount / 1_000_000_000).toFixed(2)}B`
  }
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(2)}M`
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(1)}K`
  }
  return `${amount.toFixed(0)}`
}
