import { useEffect, useState } from 'react'
import { Redirect } from 'expo-router'
import { ensureBootstrapped, isAuthenticated } from '@/auth/session'
import { LitFinSplash } from '@/ui-litfin'

/**
 * Splash gate for the buyer app — LitFin-styled hold while the stored
 * Supabase session bootstraps, then redirect to login or marketplace.
 *
 * We MUST await `ensureBootstrapped()` before reading `isAuthenticated()`:
 * the stored session is loaded by `getSession()` inside bootstrap, and the
 * sync auth check is meaningless until that resolves. Without this a valid
 * returning user was always bounced to /auth/login.
 */
export default function Index() {
  const [ready, setReady] = useState<boolean>(false)
  useEffect(() => {
    let cancelled = false
    void ensureBootstrapped().finally(() => {
      if (!cancelled) {
        setReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])
  if (!ready) {
    return <LitFinSplash wordmark="BORJIE" tagline="Soko la Madini. Mineral marketplace." showSpinner />
  }
  if (!isAuthenticated()) {
    return <Redirect href="/auth/login" />
  }
  return <Redirect href="/marketplace" />
}
