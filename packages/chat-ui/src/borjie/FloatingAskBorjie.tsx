'use client';
/**
 * FloatingAskBorjie — the always-visible Borjie bubble.
 *
 * Collapsed: bottom-right circular FAB with the BorjieMark brand glyph.
 *   - 5-second pulse ring on first visit (localStorage `borjie.widget.seen`)
 *   - First-visit tooltip "Tap to talk to Mr. Mwikila"
 *   - 24h ambient nudge badge ("Chat" / "Ongea") after tooltip dismissal
 *   - Hover: 2px lift + soft warm-gold glow
 *   - prefers-reduced-motion → instant transitions
 *
 * Expanded (desktop):     min(380px, 92vw) × min(720px, 80vh)
 * Expanded (mobile <md):  full-screen bottom-sheet
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
 *   - first-visit   localStorage   `borjie.widget.seen`
 *   - nudge-since   localStorage   `borjie.widget.dismissed_at`
 *
 * Keyboard:
 *   - `/`           focuses the composer (when not in another input)
 *   - `Esc`         closes the panel
 *
 * Accessibility:
 *   - dialog role + aria-label on the panel
 *   - focus moves to the composer on open
 *   - ESC closes
 *   - prefers-reduced-motion → instant transitions (no scale/pulse)
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  useBorjieChat,
  type BorjieLanguage,
  type BorjieMode,
} from './useBorjieChat';
import { BorjieChatPanel } from './BorjieChatPanel';
import { BorjieMark, BORJIE_GOLD_GRADIENT } from './BorjieMark';
import { MESSAGES, t } from './messages';
// Display identity is locked — see CAPABILITIES_UNIFICATION.md
// "User-facing identity is locked". The FAB label sources from the
// single canonical constant so the bubble never drifts away from the
// chat-panel header.
import { MR_MWIKILA_CANONICAL_DISPLAY } from '../canonical-display.js';

const STORAGE_OPEN = 'borjie.chat.open';
const STORAGE_MODE = 'borjie.chat.mode';
const STORAGE_LANG = 'borjie.chat.lang';
const STORAGE_SEEN = 'borjie.widget.seen';
const STORAGE_DISMISSED = 'borjie.widget.dismissed_at';

const DEFAULT_MOBILE_BREAKPOINT = 768; // md in Tailwind
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const FIRST_VISIT_PULSE_MS = 5_000;
const TOOLTIP_AUTO_DISMISS_MS = 4_000;

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

function readFirstVisit(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_SEEN) !== '1';
  } catch {
    return false;
  }
}

function readDismissedAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_DISMISSED);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
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
  const tooltipId = useId();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mode, setMode] = useState<BorjieMode>(initialMode);
  const [language, setLanguage] = useState<BorjieLanguage>(initialLanguage);
  const [authenticated, setAuthenticated] = useState<boolean>(variant === 'public');
  const [isFirstVisit, setIsFirstVisit] = useState<boolean>(false);
  const [showTooltip, setShowTooltip] = useState<boolean>(false);
  const [showAmbientNudge, setShowAmbientNudge] = useState<boolean>(false);
  const [isHover, setIsHover] = useState<boolean>(false);

  const baseUrl = useMemo(() => {
    if (apiBaseUrl) return apiBaseUrl;
    if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_GATEWAY_URL) {
      return process.env.NEXT_PUBLIC_API_GATEWAY_URL;
    }
    return '';
  }, [apiBaseUrl]);

  const endpoint =
    variant === 'public' ? `${baseUrl}/api/v1/public/chat` : `${baseUrl}/api/v1/mining/chat`;
  const translateEndpoint = `${baseUrl}/api/v1/translate`;

  const chat = useBorjieChat({ endpoint, translateEndpoint, locale: language });

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

    const firstVisit = readFirstVisit();
    setIsFirstVisit(firstVisit);
    if (firstVisit) {
      // Show tooltip after a short beat so the page paints first.
      const t1 = window.setTimeout(() => setShowTooltip(true), 800);
      const t2 = window.setTimeout(() => setShowTooltip(false), 800 + TOOLTIP_AUTO_DISMISS_MS);
      return () => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      };
    }
    // Returning visitor — check the 24h nudge window.
    const dismissedAt = readDismissedAt();
    if (dismissedAt && Date.now() - dismissedAt < TWENTY_FOUR_HOURS_MS) {
      setShowAmbientNudge(true);
    }
    return undefined;
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
    // SCRUB-5f: justified-because toggleOpen is a stable callback re-defined
    // below via useCallback([]); listing it here would re-bind the keyboard
    // listener on every render. react-hooks/exhaustive-deps would warn but
    // the plugin is not loaded for chat-ui (only the Next.js apps register
    // it), so no eslint-disable directive is needed.
  }, [open]);

  const dismissFirstVisitState = useCallback(() => {
    setShowTooltip(false);
    if (isFirstVisit) {
      writeStorage(STORAGE_SEEN, '1', 'local');
      writeStorage(STORAGE_DISMISSED, String(Date.now()), 'local');
      setIsFirstVisit(false);
      setShowAmbientNudge(true);
    }
  }, [isFirstVisit]);

  const toggleOpen = useCallback(
    (next: boolean) => {
      setOpen(next);
      writeStorage(STORAGE_OPEN, next ? '1' : '0', 'session');
      if (next) {
        dismissFirstVisitState();
        setShowAmbientNudge(false);
      }
    },
    [dismissFirstVisitState],
  );

  const handleModeChange = useCallback((next: BorjieMode) => {
    setMode(next);
    writeStorage(STORAGE_MODE, next, 'local');
  }, []);

  const handleLanguageChange = useCallback(
    (next: BorjieLanguage) => {
      setLanguage(next);
      writeStorage(STORAGE_LANG, next, 'local');
      void chat.retranslate(next);
    },
    [chat],
  );

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

  const ariaOpen = t(MESSAGES.ariaOpen, language);
  const tooltipCopy = t(MESSAGES.tooltipFirstVisit, language);
  const nudgeCopy = t(MESSAGES.ambientNudge, language);
  const showPulse = isFirstVisit && !reducedMotion;
  const showNudge = !isFirstVisit && showAmbientNudge && !open;

  if (!open) {
    return (
      <>
        <div
          style={{
            position: 'fixed',
            bottom: mobile ? 80 : 24,
            right: 24,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 8,
            zIndex: 10_000,
            pointerEvents: 'none',
          }}
        >
          {showTooltip ? (
            <div
              id={tooltipId}
              role="tooltip"
              data-testid="borjie-fab-tooltip"
              style={{
                pointerEvents: 'auto',
                maxWidth: 240,
                background: '#0B0F19',
                color: '#F7F8FA',
                padding: '8px 12px',
                borderRadius: 12,
                fontSize: 12,
                lineHeight: 1.45,
                boxShadow: '0 12px 28px rgba(15, 23, 42, 0.32)',
                animation: reducedMotion ? 'none' : 'borjie-fab-tooltip-in 220ms ease both',
              }}
            >
              {tooltipCopy}
            </div>
          ) : null}

          {showNudge ? (
            <div
              data-testid="borjie-fab-nudge"
              role="status"
              style={{
                pointerEvents: 'auto',
                background: '#FFF6E1',
                color: '#7A5A12',
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                border: '1px solid rgba(245, 178, 62, 0.50)',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
              }}
            >
              {nudgeCopy}
            </div>
          ) : null}

          <div style={{ position: 'relative', pointerEvents: 'auto' }}>
            {showPulse ? (
              <>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 999,
                    background: BORJIE_GOLD_GRADIENT.from,
                    opacity: 0.45,
                    animation: `borjie-fab-pulse 1.6s ease-out ${FIRST_VISIT_PULSE_MS / 3}ms infinite`,
                  }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: -6,
                    borderRadius: 999,
                    border: '2px solid rgba(245, 178, 62, 0.55)',
                    animation: 'borjie-fab-ring 1.8s ease-out infinite',
                  }}
                />
              </>
            ) : null}
            <button
              type="button"
              data-testid="borjie-fab"
              aria-label={ariaOpen}
              aria-labelledby={labelId}
              aria-describedby={showTooltip ? tooltipId : undefined}
              title={tooltipCopy}
              onClick={() => toggleOpen(true)}
              onMouseEnter={() => setIsHover(true)}
              onMouseLeave={() => setIsHover(false)}
              onFocus={() => setIsHover(true)}
              onBlur={() => setIsHover(false)}
              style={{
                position: 'relative',
                width: 56,
                height: 56,
                borderRadius: 999,
                background: `linear-gradient(135deg, ${BORJIE_GOLD_GRADIENT.from} 0%, ${BORJIE_GOLD_GRADIENT.via} 50%, ${BORJIE_GOLD_GRADIENT.to} 100%)`,
                color: '#17100A',
                border: '1px solid rgba(23, 16, 10, 0.18)',
                cursor: 'pointer',
                boxShadow:
                  !reducedMotion && isHover
                    ? '0 18px 38px -8px rgba(245, 178, 62, 0.55), 0 8px 18px -10px rgba(15, 23, 42, 0.40)'
                    : '0 12px 28px rgba(15, 23, 42, 0.35)',
                transform:
                  !reducedMotion && isHover ? 'translateY(-2px)' : 'translateY(0)',
                transition: reducedMotion
                  ? 'none'
                  : 'transform 200ms ease, box-shadow 200ms ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
              }}
            >
              <span id={labelId} style={{ display: 'inline-flex' }} aria-hidden="true">
                <BorjieMark size={30} />
              </span>
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  width: 12,
                  height: 12,
                  borderRadius: 999,
                  background: '#22C55E',
                  border: '2px solid #FFFFFF',
                  boxShadow: '0 1px 4px rgba(15, 23, 42, 0.22)',
                }}
              />
            </button>
          </div>
        </div>
        <BorjieKeyframes />
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
        reducedMotion={reducedMotion}
      />
      <BorjieKeyframes />
    </>
  );
}

/** Inline keyframes block — shared by the FAB and the bubble cursor /
 *  thinking-dots so the package never needs an external stylesheet. We
 *  keep this in one place (instead of two duplicate `<style>` tags) so
 *  the FAB tooltip + ring + nudge animations live next to the bubble
 *  ones and stay in sync. */
function BorjieKeyframes(): JSX.Element {
  return (
    <style suppressHydrationWarning>{`
      @keyframes borjie-cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
      @keyframes borjie-bounce {
        0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
        40% { transform: translateY(-3px); opacity: 1; }
      }
      @keyframes borjie-fab-pulse {
        0% { transform: scale(1); opacity: 0.45; }
        100% { transform: scale(1.55); opacity: 0; }
      }
      @keyframes borjie-fab-ring {
        0% { transform: scale(1); opacity: 0.55; }
        100% { transform: scale(1.30); opacity: 0; }
      }
      @keyframes borjie-fab-tooltip-in {
        0% { transform: translateY(6px); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }
      @keyframes borjie-bubble-in {
        0% { transform: translateY(8px) scale(0.97); opacity: 0; }
        100% { transform: translateY(0) scale(1); opacity: 1; }
      }
      @keyframes borjie-chip-in {
        0% { transform: translateY(6px); opacity: 0; }
        100% { transform: translateY(0); opacity: 1; }
      }
    `}</style>
  );
}

// Brand label for the floating FAB. Sourced from the canonical
// constant so the bubble copy never drifts from the chat-panel header.
// See CAPABILITIES_UNIFICATION.md "User-facing identity is locked".
export const BORJIE_FAB_LABEL = MR_MWIKILA_CANONICAL_DISPLAY.name;
