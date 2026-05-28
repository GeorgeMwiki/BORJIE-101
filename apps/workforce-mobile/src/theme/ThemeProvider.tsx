import * as React from 'react'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react'
import { Appearance, useColorScheme as useSystemScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Mobile ThemeProvider — React Native parity for the web-side
 * `@borjie/design-system/theme`. Same three-mode contract (light /
 * dark / system) and same storage key (`borjie-theme`) so a user who
 * picks dark on the marketing site keeps dark on the mobile app when
 * we ever cross-stitch them.
 *
 * Implementation notes
 * --------------------
 *   - System tracking uses RN's `Appearance` + the `useColorScheme`
 *     hook. The provider rebinds whenever the user moves to / from
 *     `system` mode so we never fight the OS once the operator pins.
 *   - Persistence uses AsyncStorage (workforce-mobile + buyer-mobile
 *     both already depend on it for auth tokens).
 *   - We don't ship a runtime palette here — the existing `colors`
 *     module is the source of truth. This provider's job is purely
 *     to expose the *current* effective mode so screens that paint
 *     two palettes can branch. Most workforce screens are dark-only
 *     by design (outdoor field readability); the toggle still
 *     persists the user preference so cross-app consistency holds.
 */

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'borjie-theme'

interface ThemeContextValue {
  readonly theme: Theme
  readonly resolvedTheme: ResolvedTheme
  readonly setTheme: (next: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

const VALID = new Set<Theme>(['light', 'dark', 'system'])

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
}: {
  readonly children: ReactNode
  readonly defaultTheme?: Theme
}): JSX.Element {
  const systemScheme = useSystemScheme()
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [hydrated, setHydrated] = useState(false)

  // Hydrate stored preference once.
  useEffect(() => {
    let cancelled = false
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (cancelled) return
        if (value && VALID.has(value as Theme)) {
          setThemeState(value as Theme)
        }
      })
      .catch(() => {
        /* storage failures are non-fatal */
      })
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      /* ignore */
    })
  }, [])

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (theme === 'system') {
      const live = systemScheme ?? Appearance.getColorScheme()
      return live === 'light' ? 'light' : 'dark'
    }
    return theme
  }, [theme, systemScheme])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  )

  // Pre-hydration we still return a provider so consumers never crash;
  // they just see the default theme. The first render reconciles once
  // AsyncStorage replies (typically <50ms).
  void hydrated
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>.')
  }
  return ctx
}

export function useColorScheme(): ResolvedTheme {
  return useTheme().resolvedTheme
}
