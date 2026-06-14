/**
 * useBuyerTabProjection — KI-007 owner-spawn → buyer tab projection.
 *
 * Hydrates the additive projected tabs from GET /api/v1/buyer/tabs (the
 * buyerTabProjectionRouter). The result is cached to AsyncStorage so a cold
 * start renders the last-known projection immediately, then revalidates
 * against the server and refetches on app foreground (mirrors the workforce
 * useWorkforceTabConfig pattern).
 *
 * The buyer shell NEVER breaks on this: any failure degrades to the cached
 * value or honest-empty.
 */

import { useCallback, useEffect, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiFetch } from '@/api/client'
import {
  parseProjectedBuyerTabs,
  type ProjectedBuyerTab
} from '@/marketplace/buyerTabProjection'

const CACHE_KEY = 'borjie.buyer.tab-projection.v1'
const BUYER_TABS_PATH = '/api/v1/buyer/tabs'

interface ProjectionResponse {
  readonly success: boolean
  readonly data?: unknown
}

export interface UseBuyerTabProjectionResult {
  readonly projectedTabs: ReadonlyArray<ProjectedBuyerTab>
  readonly loading: boolean
  readonly refresh: () => Promise<void>
}

export function useBuyerTabProjection(): UseBuyerTabProjectionResult {
  const [projectedTabs, setProjectedTabs] = useState<ReadonlyArray<ProjectedBuyerTab>>([])
  const [loading, setLoading] = useState<boolean>(true)

  const fetchProjection = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const resp = await apiFetch<ProjectionResponse>(BUYER_TABS_PATH)
      // Re-validate every read: the server may have grown an unknown kind.
      const parsed = parseProjectedBuyerTabs(resp?.data)
      setProjectedTabs(parsed)
      try {
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(resp?.data ?? []))
      } catch {
        // ignore cache write failure — in-memory value is valid
      }
    } catch {
      const cached = await AsyncStorage.getItem(CACHE_KEY).catch(() => null)
      if (cached) {
        try {
          setProjectedTabs(parseProjectedBuyerTabs(JSON.parse(cached)))
        } catch {
          setProjectedTabs([])
        }
      } else {
        setProjectedTabs([])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    AsyncStorage.getItem(CACHE_KEY)
      .then((cached) => {
        if (cancelled || !cached) return
        try {
          setProjectedTabs(parseProjectedBuyerTabs(JSON.parse(cached)))
        } catch {
          // ignore corrupt cache; the network fetch replaces it
        }
      })
      .catch(() => {
        // ignore
      })

    void fetchProjection()

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void fetchProjection()
      }
    })

    return () => {
      cancelled = true
      sub.remove()
    }
  }, [fetchProjection])

  return { projectedTabs, loading, refresh: fetchProjection }
}
