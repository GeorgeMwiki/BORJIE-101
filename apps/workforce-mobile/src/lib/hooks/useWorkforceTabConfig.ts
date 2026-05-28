/**
 * useWorkforceTabConfig — Wave WORKFORCE-FIXED-TABS.
 *
 * Server-driven hook that hydrates the worker's FIXED tab strip from
 * `/api/v1/workforce/tab-config`. The result is cached to AsyncStorage
 * so a cold start renders the last-known shell immediately, then
 * revalidates against the server. Refetches on app foreground via the
 * existing AppState wiring.
 *
 * Tabs are NEVER mutated locally. Any worker request to change them
 * goes through `RequestTabChangeSheet` → POST
 * `/api/v1/workforce/tab-change-requests` → owner approval.
 */

import { useCallback, useEffect, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  WORKFORCE_TAB_CATALOG,
  defaultEnabledTabIdsForRole,
  type WorkforceRoleId,
  type WorkforceTabSpec
} from '@borjie/persona-runtime'
import { request } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/useAuth'
import { useI18n } from '../../../src/i18n/useI18n'
import type { Role } from '../../../src/roles/types'

const CACHE_KEY = 'borjie.workforce.tab-config.v1'

export type WorkforceTabDensity = 'comfortable' | 'compact'

export interface WorkforceTabConfigPayload {
  readonly role: WorkforceRoleId
  readonly siteScope: string
  readonly enabledTabIds: ReadonlyArray<string>
  readonly layoutDensity: WorkforceTabDensity
  readonly updatedAt: string | null
  readonly hydratedFromDefault: boolean
}

interface ApiResponse {
  readonly success: boolean
  readonly data?: WorkforceTabConfigPayload
  readonly error?: { readonly code: string; readonly message: string }
}

export interface ResolvedWorkforceTab {
  readonly id: string
  readonly label: string
}

export interface UseWorkforceTabConfigResult {
  readonly config: WorkforceTabConfigPayload | null
  readonly tabs: ReadonlyArray<ResolvedWorkforceTab>
  readonly loading: boolean
  readonly error: string | null
  readonly refresh: () => Promise<void>
}

const TAB_BY_ID = new Map<string, WorkforceTabSpec>(
  WORKFORCE_TAB_CATALOG.map((t) => [t.id, t])
)

function widenRoleToWorkforceRoleId(role: Role | undefined): WorkforceRoleId {
  switch (role) {
    case 'owner':
      return 'owner'
    case 'manager':
      return 'manager'
    case 'employee':
    default:
      return 'pit_operator'
  }
}

function buildLabel(
  spec: WorkforceTabSpec,
  lang: 'en' | 'sw'
): string {
  return spec.label[lang] ?? spec.label.en
}

function buildResolvedTabs(
  enabledIds: ReadonlyArray<string>,
  lang: 'en' | 'sw'
): ReadonlyArray<ResolvedWorkforceTab> {
  const out: ResolvedWorkforceTab[] = []
  for (const id of enabledIds) {
    const spec = TAB_BY_ID.get(id)
    if (!spec) continue
    out.push({ id, label: buildLabel(spec, lang) })
  }
  return out
}

export function useWorkforceTabConfig(): UseWorkforceTabConfigResult {
  const { user } = useAuth()
  const { lang } = useI18n()
  const role = widenRoleToWorkforceRoleId(user?.role)

  const [config, setConfig] = useState<WorkforceTabConfigPayload | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchConfig = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const resp = await request<ApiResponse>(
        '/api/v1/workforce/tab-config'
      )
      if (!resp?.success || !resp.data) {
        throw new Error(resp?.error?.message ?? 'Failed to load tab config')
      }
      setConfig(resp.data)
      try {
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(resp.data))
      } catch (cacheErr) {
        if (cacheErr instanceof Error) {
          setError(null)
        }
      }
    } catch (err) {
      const cached = await AsyncStorage.getItem(CACHE_KEY).catch(() => null)
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as WorkforceTabConfigPayload
          setConfig(parsed)
        } catch {
          setConfig({
            role,
            siteScope: 'global',
            enabledTabIds: defaultEnabledTabIdsForRole(role),
            layoutDensity: 'comfortable',
            updatedAt: null,
            hydratedFromDefault: true
          })
        }
      } else {
        setConfig({
          role,
          siteScope: 'global',
          enabledTabIds: defaultEnabledTabIdsForRole(role),
          layoutDensity: 'comfortable',
          updatedAt: null,
          hydratedFromDefault: true
        })
      }
      setError(
        err instanceof Error ? err.message : 'Unknown tab config error'
      )
    } finally {
      setLoading(false)
    }
  }, [role])

  useEffect(() => {
    let cancelled = false

    AsyncStorage.getItem(CACHE_KEY)
      .then((cached) => {
        if (cancelled || !cached) return
        try {
          const parsed = JSON.parse(cached) as WorkforceTabConfigPayload
          setConfig(parsed)
          setLoading(false)
        } catch {
          // Ignore corrupt cache; the network fetch below will replace it.
        }
      })
      .catch(() => {
        // ignore
      })

    void fetchConfig()

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void fetchConfig()
      }
    })

    return () => {
      cancelled = true
      sub.remove()
    }
  }, [fetchConfig])

  const tabs = buildResolvedTabs(
    config?.enabledTabIds ?? defaultEnabledTabIdsForRole(role),
    lang
  )

  return {
    config,
    tabs,
    loading,
    error,
    refresh: fetchConfig
  }
}
