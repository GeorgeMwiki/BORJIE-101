'use client';

/**
 * Widget — Borjie's floating Mr. Mwikila chat bubble.
 *
 * Carbon-copy port of LitFin's `LitFinWidget.tsx` with the brand swapped
 * to BorjieMark + Mr. Mwikila persona (Borjie's AI Estate-Management
 * Director, covers both property and mining).
 *
 * Source of mirror:
 *   LITFIN_PATH/src/core/litfin-ai/components/LitFinWidget.tsx
 *
 * Features (identical to LitFin):
 *   - Floating Action Button (FAB) bottom-right with copper-on-cream
 *     gradient + animated ping ring on first visit (5 s) + 24 h ambient
 *     "Tap me to chat" nudge after the cinematic onboarding finishes.
 *   - Welcome tooltip on first visit (auto-dismisses after 8 s).
 *   - Contextual suggestion chips for the marketing portal (appear
 *     above the FAB once the tooltip fades, 120 ms stagger).
 *   - Lazy-loaded ChatPanel via next/dynamic so the heavy chat bundle
 *     never blocks the page first paint.
 *   - Idle-callback preload after mount so first-open is sub-frame.
 *   - localStorage-backed first-visit detection + ambient-nudge wake.
 *   - prefers-reduced-motion → instant transitions (handled by the
 *     primitives the panel composes).
 *
 * Visual fidelity rules (DO NOT modify):
 *   - FAB geometry (h-14 w-14 round, bottom-6 right-6)
 *   - Pulse ring (animate-ping, opacity-40)
 *   - Chip stagger (120 ms × i, 400 ms duration, fade + slide-from-bottom)
 *   - Tooltip arrow (h-3 w-3 rotate-45)
 *   - Online dot (h-3.5 w-3.5 emerald-500 with optional ping)
 */

import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';

import { BorjieMark } from '../borjie/BorjieMark.js';
import { CHAT_HEADER_GRADIENT } from '../litfin-primitives.js';
import { WidgetErrorBoundary } from './WidgetErrorBoundary.js';
import { useOptionalBorjieAI } from './BorjieAIProvider.js';
import type { UnifiedChat, WidgetStrings } from './types.js';
import {
  getWidgetSuggestionChips,
  getWidgetWelcomeMessage,
  type WidgetSuggestionChip,
} from './widget-content.js';

// ---------------------------------------------------------------------------
// Lazy-load ChatPanel — only fetched when user opens the widget.
// Mirrors LitFin's loader pattern so the initial JS payload stays small.
// ---------------------------------------------------------------------------
interface LazyChatPanelProps {
  readonly chat: UnifiedChat;
  readonly strings: WidgetStrings;
  readonly onClose: () => void;
  readonly variant?: 'floating' | 'full' | 'bottom-sheet' | undefined;
}

const loadChatPanel = (): Promise<{
  default: ComponentType<LazyChatPanelProps>;
}> =>
  import('./ChatPanel.js').then((m) => ({
    default: m.ChatPanel as unknown as ComponentType<LazyChatPanelProps>,
  }));

const ChatPanel = dynamic(loadChatPanel, {
  ssr: false,
  loading: () => (
    <div className="fixed bottom-4 right-4 z-50 flex h-[min(78vh,720px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-[28px] border border-border/50 bg-background/92 shadow-[0_28px_80px_rgb(15_23_42_/_0.22)] ring-1 ring-border/20 backdrop-blur-2xl md:bottom-6 md:right-6">
      <div
        className={`flex items-center justify-between border-b border-white/10 ${CHAT_HEADER_GRADIENT} px-4 py-3 text-primary-foreground`}
      >
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-2xl bg-primary-foreground/20 animate-pulse" />
          <div className="h-4 w-24 rounded bg-primary-foreground/20 animate-pulse" />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-3/4 animate-pulse space-y-3">
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted" />
        </div>
      </div>
    </div>
  ),
});

// Storage key for tracking if user has seen the widget before.
const WIDGET_SEEN_KEY = 'borjie-widget-seen';
const ONBOARDING_COMPLETED_AT_KEY = 'borjie-widget-onboarding-completed-at';
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function hasSeenWidget(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(WIDGET_SEEN_KEY) === 'true';
  } catch {
    return true;
  }
}

function markWidgetSeen(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WIDGET_SEEN_KEY, 'true');
  } catch {
    // sessionStorage / localStorage may be unavailable — ignore.
  }
}

export interface WidgetProps {
  /** Override the portal id (defaults to provider). */
  readonly portalId?: 'public' | 'owner' | 'admin' | 'estate-manager' | 'customer';
  /** Override the current route (defaults to provider). */
  readonly currentRoute?: string;
}

/**
 * The Borjie floating Mr. Mwikila widget. Mirrors LitFinWidget.tsx
 * line-for-line on the FAB / tooltip / chips / pulse behaviour.
 */
export function Widget({
  portalId: portalIdOverride,
  currentRoute: currentRouteOverride,
}: WidgetProps = {}): JSX.Element | null {
  const ctx = useOptionalBorjieAI();

  const language: 'en' | 'sw' = ctx?.chat.language === 'sw' ? 'sw' : 'en';
  const portalId =
    portalIdOverride ?? (ctx?.chat.route.portal ?? 'public');
  const currentRoute = currentRouteOverride ?? ctx?.chat.route.path ?? '/';

  const isOpen = ctx?.chat.mode !== 'collapsed';

  const [showTooltip, setShowTooltip] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(() => !hasSeenWidget());
  const [showChips, setShowChips] = useState(false);
  const [hasBeenOpened, setHasBeenOpened] = useState(false);
  const [isAmbientPulsing, setIsAmbientPulsing] = useState(false);
  const [showAmbientNudge, setShowAmbientNudge] = useState(false);

  // Once opened, always keep ChatPanel mounted so memory + scroll
  // position survive minimize/restore (mirrors LitFin behaviour).
  useEffect(() => {
    if (isOpen && !hasBeenOpened) setHasBeenOpened(true);
  }, [isOpen, hasBeenOpened]);

  // Preload the full chat panel after initial render so first-open
  // latency is sub-frame without pulling the heavy chat bundle into
  // the critical path. Uses requestIdleCallback when available.
  useEffect(() => {
    if (hasBeenOpened) return;
    if (typeof window === 'undefined') return;

    const preload = (): void => {
      void loadChatPanel();
    };

    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(preload, { timeout: 2500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timer = globalThis.setTimeout(preload, 1800);
    return () => globalThis.clearTimeout(timer);
  }, [hasBeenOpened]);

  // Show suggestion chips after tooltip dismisses (public portal only).
  useEffect(() => {
    if (portalId !== 'public' || isOpen) {
      setShowChips(false);
      return;
    }
    const timer = setTimeout(
      () => setShowChips(true),
      isFirstVisit ? 9000 : 2000,
    );
    return () => clearTimeout(timer);
  }, [portalId, isOpen, isFirstVisit]);

  const pageSuggestions: ReadonlyArray<WidgetSuggestionChip> = useMemo(
    () => getWidgetSuggestionChips(portalId, currentRoute, language),
    [portalId, currentRoute, language],
  );

  const handleChipClick = useCallback(
    (prompt: string) => {
      setShowChips(false);
      // Store the prompt in sessionStorage so ChatPanel picks it up on
      // mount (mirrors LitFin's chip-handoff pattern).
      try {
        sessionStorage.setItem('borjie-pending-chip-prompt', prompt);
      } catch {
        (window as unknown as Record<string, unknown>).__borjiePendingPrompt =
          prompt;
      }
      ctx?.chat.switchMode('expanded');
    },
    [ctx],
  );

  // Listen for borjie-open-chat event dispatched by onboarding components.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOpenChat = (): void => {
      if (!isOpen) ctx?.chat.switchMode('expanded');
    };
    window.addEventListener('borjie-open-chat', handleOpenChat);
    return () => {
      window.removeEventListener('borjie-open-chat', handleOpenChat);
    };
  }, [isOpen, ctx]);

  // Listen for the Borjie AI cinematic onboarding handoff. When the
  // takeover finishes, pulse the bubble for 5 s and surface a
  // "Tap me to chat" nudge for 24 h.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const completedAt = Number(
        localStorage.getItem(ONBOARDING_COMPLETED_AT_KEY) ?? '0',
      );
      if (completedAt > 0 && Date.now() - completedAt < TWENTY_FOUR_HOURS_MS) {
        setShowAmbientNudge(true);
      }
    } catch {
      // ignore
    }

    let pulseTimer: ReturnType<typeof setTimeout> | null = null;
    const handleHandoff = (): void => {
      setIsAmbientPulsing(true);
      setShowAmbientNudge(true);
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => setIsAmbientPulsing(false), 5000);
    };

    window.addEventListener(
      'borjie-onboarding-complete',
      handleHandoff as EventListener,
    );
    return () => {
      window.removeEventListener(
        'borjie-onboarding-complete',
        handleHandoff as EventListener,
      );
      if (pulseTimer) clearTimeout(pulseTimer);
    };
  }, []);

  // Show welcome tooltip on first visit (1.5 s in, dismiss after 8 s).
  useEffect(() => {
    if (!isFirstVisit) return;
    const tooltipTimer = setTimeout(() => setShowTooltip(true), 1500);
    const dismissTimer = setTimeout(() => {
      setShowTooltip(false);
      markWidgetSeen();
      setIsFirstVisit(false);
    }, 8000);
    return () => {
      clearTimeout(tooltipTimer);
      clearTimeout(dismissTimer);
    };
  }, [isFirstVisit]);

  if (!ctx) return null;
  if (!ctx.featureEnabled) return null;

  const welcomeMessage = getWidgetWelcomeMessage(
    portalId,
    currentRoute,
    language,
  );

  const tooltipNudgeText =
    language === 'sw' ? 'Nibofye tuongee' : 'Tap me to chat';

  const fabAriaLabel =
    language === 'sw'
      ? 'Zungumza na Mr. Mwikila, Mkurugenzi wa AI wa Usimamizi wa Mali'
      : "Chat with Mr. Mwikila, Borjie's AI Estate-Management Director";

  const fabTitle =
    language === 'sw' ? 'Uliza Mr. Mwikila' : 'Ask Mr. Mwikila';

  const closeWidget = (): void => ctx.chat.switchMode('collapsed');

  return (
    <WidgetErrorBoundary>
      {/* Floating Action Button + Suggestion Chips */}
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
          {/* Welcome tooltip — first visit only */}
          {showTooltip && welcomeMessage && (
            <div
              id="borjie-widget-tooltip"
              role="tooltip"
              className="relative mr-1 max-w-[240px] rounded-xl border border-border/50 bg-popover px-4 py-2.5 text-sm text-popover-foreground shadow-lg animate-in fade-in slide-in-from-bottom-2"
            >
              <p>{welcomeMessage}</p>
              <div className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 border-b border-r border-border/50 bg-popover" />
            </div>
          )}

          {/* Contextual suggestion chips — marketing surface, post-tooltip */}
          {showChips && !showTooltip && pageSuggestions.length > 0 && (
            <div className="mr-1 flex flex-col items-end gap-1.5">
              {pageSuggestions.map((chip, i) => (
                <button
                  type="button"
                  key={chip.label}
                  onClick={() => handleChipClick(chip.prompt)}
                  className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/95 px-3.5 py-2 text-xs font-medium text-foreground shadow-md backdrop-blur-sm transition-all animate-in fade-in slide-in-from-bottom-3 hover:scale-[1.02] hover:border-primary/30 hover:bg-primary/5 hover:shadow-lg active:scale-[0.98]"
                  style={{
                    animationDelay: `${i * 120}ms`,
                    animationFillMode: 'both',
                    animationDuration: '400ms',
                  }}
                >
                  <span>{chip.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* "Tap me to chat" gentle nudge after cinematic onboarding */}
          {showAmbientNudge && !showTooltip && !isFirstVisit && (
            <div
              role="status"
              className="relative mr-1 max-w-[200px] rounded-xl border border-primary/30 bg-popover px-3.5 py-2 text-xs font-medium text-popover-foreground shadow-md animate-in fade-in slide-in-from-bottom-2"
            >
              {tooltipNudgeText}
              <div className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 border-b border-r border-primary/30 bg-popover" />
            </div>
          )}

          {/* FAB button with pulse animation for first visit OR ambient handoff */}
          <div className="relative">
            {(isFirstVisit || isAmbientPulsing) && (
              <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-40" />
            )}
            {isAmbientPulsing && (
              <span
                aria-hidden="true"
                className="absolute -inset-2 animate-pulse rounded-full ring-2 ring-primary/40"
              />
            )}
            <button
              type="button"
              data-borjie-widget-fab=""
              onClick={() => {
                ctx.chat.switchMode('expanded');
                setShowChips(false);
                if (isFirstVisit) {
                  markWidgetSeen();
                  setIsFirstVisit(false);
                  setShowTooltip(false);
                }
              }}
              onMouseEnter={() => {
                // Preload chunk on hover so click-to-open is instant.
                if (!hasBeenOpened) void loadChatPanel();
              }}
              onFocus={() => {
                if (!hasBeenOpened) void loadChatPanel();
              }}
              className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:scale-105 hover:shadow-xl hover:shadow-primary/30 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background active:scale-95"
              aria-label={fabAriaLabel}
              aria-describedby={
                showTooltip ? 'borjie-widget-tooltip' : undefined
              }
              title={fabTitle}
            >
              <BorjieMark size={28} />
              {/* Online indicator dot — suppress ping during first-visit pulse */}
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${
                    isFirstVisit ? '' : 'animate-ping'
                  }`}
                />
                <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-background bg-emerald-500" />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Chat Panel — always mounted once opened to preserve memory */}
      {hasBeenOpened && (
        <div className={isOpen ? '' : 'hidden'}>
          <ChatPanel
            chat={ctx.chat}
            strings={ctx.strings}
            onClose={closeWidget}
            variant="floating"
          />
        </div>
      )}
    </WidgetErrorBoundary>
  );
}
