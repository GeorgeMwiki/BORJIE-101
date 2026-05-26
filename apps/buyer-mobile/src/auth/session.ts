import { useEffect, useState } from 'react'
import { clearAuthToken } from './token'
import type { BuyerUser } from '@/types/auth'

// Reactive in-memory session store. Wired against /api/v1/auth/* via
// src/api/auth.ts; persistence is handled by AsyncStorage in token.ts.
//
// The stub user remains so screens render before login completes — once
// verifyOtp() resolves, setCurrentUser() flips the state and subscribers
// (useSession) re-render with real data.

const stubUser: BuyerUser = {
  id: 'buyer-001',
  role: 'buyer',
  companyName: 'Pamoja Refinery Ltd',
  countryCode: 'TZ',
  preferredLang: 'en',
  kycStatus: 'submitted',
  phone: '+255 712 000 001'
}

type Listener = (user: BuyerUser | null) => void

let currentUser: BuyerUser | null = stubUser
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) {
    listener(currentUser)
  }
}

export function getCurrentUser(): BuyerUser {
  return currentUser ?? stubUser
}

export function isAuthenticated(): boolean {
  return Boolean(currentUser?.id)
}

export function setCurrentUser(user: BuyerUser): void {
  currentUser = user
  emit()
}

export function setPreferredLang(lang: BuyerUser['preferredLang']): void {
  if (!currentUser) {
    return
  }
  currentUser = { ...currentUser, preferredLang: lang }
  emit()
}

export async function logout(): Promise<void> {
  currentUser = null
  await clearAuthToken()
  emit()
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSession(): BuyerUser {
  const [user, setUser] = useState<BuyerUser>(() => getCurrentUser())
  useEffect(() => subscribe((next) => setUser(next ?? stubUser)), [])
  return user
}
