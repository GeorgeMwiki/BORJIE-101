'use client';

import * as React from 'react';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';

/**
 * Borjie ThemeProvider — LitFin-parity colour-scheme provider.
 *
 * Why this file exists
 * --------------------
 * Borjie's `globals.css` already ships both a `:root` (light) and a
 * `.dark` (dark) token palette — the Tailwind config inherits
 * `darkMode: 'class'`. We just lacked the runtime that flips the root
 * class. This provider supplies it, modelled on LitFin's self-contained
 * `ThemeProvider` (so we don't pull in a new `next-themes` dep just for
 * three apps).
 *
 * Three theme values:
 *   - `light` — operator chooses the cream + slate palette explicitly.
 *   - `dark`  — operator chooses the navy + cream palette explicitly.
 *   - `system` — track `prefers-color-scheme` and update live.
 *
 * Defaults
 * --------
 * The `defaultTheme` is set per-surface. The marketing site, owner
 * cockpit, and admin console all default to `dark` (their previously
 * hard-coded `<html className="dark">`). The user override survives in
 * `localStorage` under `borjie-theme`.
 *
 * Hydration safety
 * ----------------
 * Storage is read in a `useEffect` after mount; the SSR HTML still ships
 * with the default class so we never flash the wrong scheme. A small
 * `BORJIE_THEME_BOOTSTRAP_SCRIPT` (sibling file) inlines into `<head>`
 * to apply the stored scheme before React hydrates, defeating FOUC.
 */

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeProviderProps {
  readonly children: React.ReactNode;
  /** Default scheme on first visit, before localStorage has been
   *  consulted. Falls back to `dark` to preserve current Borjie look. */
  readonly defaultTheme?: Theme;
  /** localStorage key. Default `borjie-theme`. */
  readonly storageKey?: string;
  /** When `true`, the `system` value tracks `prefers-color-scheme`. */
  readonly enableSystem?: boolean;
  /** Suspend transition animations while the class flips, avoiding the
   *  flash of overshooting interpolations on slow paints. */
  readonly disableTransitionOnChange?: boolean;
}

interface ThemeContextValue {
  readonly theme: Theme;
  readonly resolvedTheme: ResolvedTheme;
  readonly setTheme: (next: Theme) => void;
  readonly toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const VALID_THEMES: ReadonlySet<Theme> = new Set(['light', 'dark', 'system']);

function readSystemScheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === 'system' ? readSystemScheme() : theme;
}

/** Apply the resolved scheme to `<html>`. Sets the Tailwind class, a
 *  `data-theme` attribute (any CSS that keys off it), and the
 *  `color-scheme` property (native form widgets + scrollbars). */
function applySchemeToRoot(
  scheme: ResolvedTheme,
  disableTransitionOnChange: boolean,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (disableTransitionOnChange) {
    root.style.setProperty('--transition-duration', '0s');
  }
  root.classList.remove('light', 'dark');
  root.classList.add(scheme);
  root.setAttribute('data-theme', scheme);
  root.style.colorScheme = scheme;
  try {
    window.dispatchEvent(
      new CustomEvent('borjie-theme-change', { detail: { theme: scheme } }),
    );
  } catch {
    /* SSR or sandboxed env */
  }
  if (disableTransitionOnChange) {
    // Force reflow then drop the override so subsequent animations work.
    void root.offsetHeight;
    root.style.removeProperty('--transition-duration');
  }
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
  storageKey = 'borjie-theme',
  enableSystem = true,
  disableTransitionOnChange = false,
}: ThemeProviderProps): JSX.Element {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolved] = useState<ResolvedTheme>(
    resolveTheme(defaultTheme),
  );
  const [mounted, setMounted] = useState(false);

  // Hydrate from storage once on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored && VALID_THEMES.has(stored as Theme)) {
        setThemeState(stored as Theme);
      }
    } catch {
      /* private mode / no storage */
    }
    setMounted(true);
  }, [storageKey]);

  // Apply scheme whenever `theme` resolves to a different value.
  useEffect(() => {
    if (!mounted) return;
    const next = resolveTheme(theme);
    setResolved(next);
    applySchemeToRoot(next, disableTransitionOnChange);
  }, [theme, mounted, disableTransitionOnChange]);

  // Track system changes when in `system` mode.
  useEffect(() => {
    if (!enableSystem || !mounted) return;
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = readSystemScheme();
      setResolved(next);
      applySchemeToRoot(next, disableTransitionOnChange);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme, enableSystem, mounted, disableTransitionOnChange]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* ignore */
      }
    },
    [storageKey],
  );

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === 'light' ? 'dark' : 'light');
  }, [resolvedTheme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>.');
  }
  return ctx;
}

/** Hook returning only the resolved scheme (no setters) for components
 *  that need to branch on light vs dark without rerendering on every
 *  toggle interaction. */
export function useColorScheme(): ResolvedTheme {
  return useTheme().resolvedTheme;
}
