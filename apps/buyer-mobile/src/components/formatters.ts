export function formatTzs(amount: number): string {
  if (amount >= 1_000_000_000) {
    return `TZS ${(amount / 1_000_000_000).toFixed(2)}B`
  }
  if (amount >= 1_000_000) {
    return `TZS ${(amount / 1_000_000).toFixed(2)}M`
  }
  if (amount >= 1_000) {
    return `TZS ${(amount / 1_000).toFixed(1)}K`
  }
  return `TZS ${amount.toFixed(0)}`
}

export function formatKg(kg: number): string {
  if (kg < 1) {
    return `${(kg * 1000).toFixed(0)} g`
  }
  if (kg >= 1000) {
    return `${(kg / 1000).toFixed(1)} t`
  }
  return `${kg.toFixed(kg < 10 ? 2 : 0)} kg`
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
}
