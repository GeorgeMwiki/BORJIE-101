'use client';
/**
 * FloatingAskBorjie — the always-visible Borjie bubble.
 *
 * Collapsed: bottom-right circular FAB with brand mark "B".
 * Expanded (desktop):     380×560 floating corner panel.
 * Expanded (mobile <md):   full-screen bottom-sheet.
 *
 * Two variants:
 *   - `public`         — anonymous mode for the marketing site; talks to
 *                        POST /api/v1/public/chat which serves curated
 *                        Borjie-about-Borjie responses (no tenant data).
 *   - `authenticated`  — owner-web / admin-web; talks to
 *                        POST /api/v1/mining/chat. Reads supabase access
 *                        token from a host-provided getter; if absent,
 *                        the widget renders a sign-in prompt instead of
 *                        the composer.
 *
 * Persistence:
 *   - open-state    sessionStorage `borjie.chat.open`
 *   - mode          localStorage   `borjie.chat.mode`
 *   - language      localStorage   `borjie.chat.lang`
 *
 * Keyboard:
 *   - `/`           focuses the composer (when not in another input)
 *   - `Esc`         closes the panel
 *
 * Accessibility:
 *   - dialog role + aria-label on the panel
 *   - focus moves to the composer on open
 *   - ESC closes
 *   - prefers-reduced-motion → instant transitions (no scale animation)
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  useBorjieChat,
  type BorjieLanguage,
  type BorjieMode,
} from './useBorjieChat';
import { BorjieChatPanel } from './BorjieChatPanel';

const STORAGE_OPEN = 'borjie.chat.open';
const STORAGE_MODE = 'borjie.chat.mode';
const STORAGE_LANG = 'borjie.chat.lang';

const DEFAULT_MOBILE_BREAKPOINT = 768; // md in Tailwind

export type FloatingAskBorjieVariant = 'public' | 'authenticated';

export interface FloatingAskBorjieProps {
  readonly variant: FloatingAskBorjieVariant;
  /**
   * Optional override for the API gateway base URL. Falls back to
   * NEXT_PUBLIC_API_GATEWAY_URL when undefined, then to the empty
   * string (which makes the fetch relative — useful in tests + when
   * the app is reverse-proxied behind the same origin).
   */
  readonly apiBaseUrl?: string;
  /**
   * Supplied by host apps that authenticate via Supabase. Returns the
   * current access token (or null when the user is signed out). The
   * widget calls this on every send. Ignored for `public` variant.
   */
  readonly getAccessToken?: () => Promise<string | null>;
  readonly signInHref?: string;
  readonly mobileBreakpoint?: number;
  /**
   * Optional callback for opening an evidence citation in a side
   * panel. Host apps wire this to their own document viewer; if
   * unset, evidence chips are still rendered but become no-ops.
   */
  readonly onOpenEvidence?: (evidenceId: string) => void;
  readonly initialMode?: BorjieMode;
  readonly initialLanguage?: BorjieLanguage;
}

function readStorage(key: string, kind: 'local' | 'session'): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    return s.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string, kind: 'local' | 'session'): void {
  if (typeof window === 'undefined') return;
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    s.setItem(key, value);
  } catch {
    /* quota / privacy mode — ignore */
  }
}

function isValidMode(v: string | null): v is BorjieMode {
  return (
    v === 'build' ||
    v === 'strategy' ||
    v === 'operations' ||
    v === 'document' ||
    v === 'finance' ||
    v === 'risk' ||
    v === 'board-investor' ||
    v === 'compliance'
  );
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function FloatingAskBorjie(props: FloatingAskBorjieProps): JSX.Element | null {
  const {
    variant,
    apiBaseUrl,
    getAccessToken,
    signInHref,
    mobileBreakpoint = DEFAULT_MOBILE_BREAKPOINT,
    onOpenEvidence,
    initialMode = 'build',
    initialLanguage = 'en',
  } = props;

  const labelId = useId();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mode, setMode] = useState<BorjieMode>(initialMode);
  const [language, setLanguage] = useState<BorjieLanguage>(initialLanguage);
  const [authenticated, setAuthenticated] = useState<boolean>(variant === 'public');

  const baseUrl = useMemo(() => {
    if (apiBaseUrl) return apiBaseUrl;
    if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_GATEWAY_URL) {
      return process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    }
    return '';
  }, [apiBaseUrl]);

  const endpoint =
    variant === 'public' ? `${baseUrl}/api/v1/public/chat` : `${baseUrl}/api/v1/mining/chat`;

  const chat = useBorjieChat({ endpoint });

  // ---- mount + storage rehydrate ----
  useEffect(() => {
    setMounted(true);
    const storedOpen = readStorage(STORAGE_OPEN, 'session');
    if (storedOpen === '1') setOpen(true);
    const storedMode = readStorage(STORAGE_MODE, 'local');
    if (isValidMode(storedMode)) setMode(storedMode);
    const storedLang = readStorage(STORAGE_LANG, 'local');
    if (storedLang === 'sw' || storedLang === 'en') setLanguage(storedLang);
    setReducedMotion(prefersReducedMotion());
  }, []);

  // ---- viewport-driven variant ----
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${mobileBreakpoint - 1}px)`);
    const listener = () => setMobile(mql.matches);
    setMobile(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }
    mql.addListener(listener);
    return () => mql.removeListener(listener);
  }, [mobileBreakpoint]);

  // ---- auth status (authenticated variant only) ----
  useEffect(() => {
    if (variant !== 'authenticated' || !getAccessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const tok = await getAccessToken();
        if (!cancelled) setAuthenticated(Boolean(tok));
      } catch {
        if (!cancelled) setAuthenticated(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [variant, getAccessToken]);

  // ---- global keyboard: `/` focuses, Esc closes ----
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && !open) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName ?? '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        e.preventDefault();
        toggleOpen(true);
      } else if (e.key === 'Escape' && open) {
        toggleOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleOpen = useCallback((next: boolean) => {
    setOpen(next);
    writeStorage(STORAGE_OPEN, next ? '1' : '0', 'session');
  }, []);

  const handleModeChange = useCallback((next: BorjieMode) => {
    setMode(next);
    writeStorage(STORAGE_MODE, next, 'local');
  }, []);

  const handleLanguageChange = useCallback((next: BorjieLanguage) => {
    setLanguage(next);
    writeStorage(STORAGE_LANG, next, 'local');
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      let accessToken: string | null = null;
      if (variant === 'authenticated' && getAccessToken) {
        try {
          accessToken = await getAccessToken();
        } catch {
          accessToken = null;
        }
      }
      await chat.send(text, { mode, language, accessToken });
    },
    [chat, mode, language, variant, getAccessToken],
  );

  if (!mounted) return null;

  const ariaOpen = language === 'sw' ? 'Fungua Borjie' : 'Open Borjie';

  if (!open) {
    return (
      <>
        <button
          type="button"
          data-testid="borjie-fab"
          aria-label={ariaOpen}
          aria-labelledby={labelId}
          onClick={() => toggleOpen(true)}
          style={{
            position: 'fixed',
            bottom: mobile ? 80 : 24,
            right: 24,
            width: 56,
            height: 56,
            borderRadius: 999,
            background:
              'linear-gradient(135deg, #C9A66B 0%, #8B6914 100%)',
            color: '#17100A',
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 12px 28px rgba(15, 23, 42, 0.35)',
            fontSize: 22,
            fontWeight: 700,
            fontFamily: 'inherit',
            zIndex: 10_000,
            transition: reducedMotion ? 'none' : 'transform 180ms ease, box-shadow 180ms ease',
          }}
          onFocus={(e) => {
            if (!reducedMotion) e.currentTarget.style.transform = 'scale(1.06)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseEnter={(e) => {
            if (!reducedMotion) e.currentTarget.style.transform = 'scale(1.06)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <span id={labelId} style={{ display: 'inline-block' }}>
            B
          </span>
        </button>
        <style suppressHydrationWarning>{`@keyframes borjie-cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
      </>
    );
  }

  return (
    <>
      <BorjieChatPanel
        chat={chat}
        mode={mode}
        language={language}
        onChangeMode={handleModeChange}
        onChangeLanguage={handleLanguageChange}
        onClose={() => toggleOpen(false)}
        variant={mobile ? 'bottom-sheet' : 'floating'}
        authenticated={authenticated}
        signInHref={signInHref}
        onSend={handleSend}
        onOpenEvidence={onOpenEvidence}
      />
      <style suppressHydrationWarning>{`@keyframes borjie-cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
    </>
  );
}

// Brand placeholder kept for downstream consumers (e.g. tests + custom shells).
export const BORJIE_FAB_LABEL = 'Borjie';
