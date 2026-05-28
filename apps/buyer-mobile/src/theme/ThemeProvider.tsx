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
 * Buyer-mobile ThemeProvider — mirrors workforce-mobile's contract
 * one-to-one. Persists under the same `borjie-theme` AsyncStorage key
 * so the operator's choice in one app is honoured in the other.
 *
 * The buyer surface ships a bone-coloured marketplace and a slate-on-
 * gold checkout; light vs dark mode toggles which one is the default
 * pane background. Most cards are scheme-aware via the existing
 * `colors` module — this provider simply exposes the *current* mode
 * for the few places (charts, drawers) that need to branch.
 */

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'borjie-theme'
const VALID = new Set<Theme>(['light', 'dark', 'system'])

interface ThemeContextValue {
  readonly theme: Theme
  readonly resolvedTheme: ResolvedTheme
  readonly setTheme: (next: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
}: {
  readonly children: ReactNode
  readonly defaultTheme?: Theme
}): JSX.Element {
  const systemScheme = useSystemScheme()
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [, setHydrated] = useState(false)

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
        /* storage failure is non-fatal */
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
