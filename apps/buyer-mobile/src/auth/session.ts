import type { BuyerUser } from '@/types/auth'

// Auth shim — real implementation will swap for phone-OTP + JWT pair
// against the Borjie identity service. Treat as readonly.
export const stubUser: BuyerUser = {
  id: 'buyer-001',
  role: 'buyer',
  companyName: 'Pamoja Refinery Ltd',
  countryCode: 'TZ',
  preferredLang: 'sw',
  kycStatus: 'submitted',
  phone: '+255 712 000 001'
}

export function getCurrentUser(): BuyerUser {
  return stubUser
}

export function isAuthenticated(): boolean {
  return Boolean(stubUser.id)
}
