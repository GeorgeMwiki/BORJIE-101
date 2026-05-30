'use client';

/**
 * Borjie AI Floating Widget — carbon copy of LitFin's LitFinWidget,
 * Borjie-skinned.
 *
 * Floating action button (FAB) in the bottom-right that expands into
 * a full chat panel. Appears on every page where the provider is mounted.
 *
 * Features:
 * - Pulse animation on first visit
 * - Welcome tooltip that auto-dismisses
 * - Contextual suggestion chips above the FAB
 * - Smooth open/close transitions
 * - Identical Mr. Mwikila persona across surfaces
 *
 * Source pattern this mirrors:
 *   LITFIN_PATH/src/core/litfin-ai/components/LitFinWidget.tsx
 */

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type JSX,
} from 'react';
import { BorjieMark } from '../borjie/BorjieMark';
import { useLitFinAI } from './LitFinAIProvider';
import { useWidgetLanguage } from './useWidgetLanguage';
import { WidgetErrorBoundary } from './WidgetErrorBoundary';
import { LitFinChatPanel } from './LitFinChatPanel';
import {
  getWidgetSuggestionChips,
  getWidgetWelcomeMessage,
  type WidgetPortalId,
} from './litfin-widget-content';

const WIDGET_SEEN_KEY = 'borjie-litfin-widget-seen';

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
    /* ignore */
  }
}

export function LitFinWidget(): JSX.Element {
  const { portalId, currentRoute, isOpen, toggleWidget, closeWidget } =
    useLitFinAI();
  const { language } = useWidgetLanguage();
  const [showTooltip, setShowTooltip] = useState(false);
  const [isFirstVisit, setIsFirstVisit] = useState(() => !hasSeenWidget());
  const [showChips, setShowChips] = useState(false);
  const [hasBeenOpened, setHasBeenOpened] = useState(false);

  useEffect(() => {
    if (isOpen && !hasBeenOpened) {
      setHasBeenOpened(true);
    }
  }, [isOpen, hasBeenOpened]);

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

  const pageSuggestions = useMemo(
    () =>
      getWidgetSuggestionChips(
        portalId as WidgetPortalId,
        currentRoute,
        language,
      ),
    [portalId, currentRoute, language],
  );

  const handleChipClick = useCallback(
    (prompt: string) => {
      setShowChips(false);
      try {
        sessionStorage.setItem('borjie-litfin-pending-chip-prompt', prompt);
      } catch {
        /* ignore */
      }
      toggleWidget();
    },
    [toggleWidget],
  );

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOpenChat = () => {
      if (!isOpen) toggleWidget();
    };
    window.addEventListener('borjie-litfin-open-chat', handleOpenChat);
    return () => {
      window.removeEventListener('borjie-litfin-open-chat', handleOpenChat);
    };
  }, [isOpen, toggleWidget]);

  const welcomeMessage = getWidgetWelcomeMessage(
    portalId as WidgetPortalId,
    currentRoute,
    language,
  );

  const askLabel =
    language === 'sw' ? 'Uliza Mr. Mwikila' : 'Ask Mr. Mwikila';

  return (
    <WidgetErrorBoundary>
      {!isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
          {showTooltip && welcomeMessage && (
            <div
              id="borjie-litfin-widget-tooltip"
              role="tooltip"
              className="relative animate-in fade-in slide-in-from-bottom-2 mr-1 max-w-[240px] rounded-xl bg-popover px-4 py-2.5 text-sm text-popover-foreground shadow-lg border border-border/50"
            >
              <p>{welcomeMessage}</p>
              <div className="absolute -bottom-1.5 right-6 h-3 w-3 rotate-45 bg-popover border-r border-b border-border/50" />
            </div>
          )}

          {showChips && !showTooltip && pageSuggestions.length > 0 && (
            <div className="flex flex-col items-end gap-1.5 mr-1">
              {pageSuggestions.map((chip, i) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => handleChipClick(chip.prompt)}
                  className="flex items-center gap-1.5 rounded-full bg-background/95 backdrop-blur-sm px-3.5 py-2 text-xs font-medium text-foreground shadow-md border border-border/50 hover:bg-primary/5 hover:border-primary/30 hover:shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] animate-in fade-in slide-in-from-bottom-3"
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

          <div className="relative">
            {isFirstVisit && (
              <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-40" />
            )}
            <button
              type="button"
              data-bn-widget-fab=""
              onClick={() => {
                toggleWidget();
                setShowChips(false);
                if (isFirstVisit) {
                  markWidgetSeen();
                  setIsFirstVisit(false);
                  setShowTooltip(false);
                }
              }}
              className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background active:scale-95"
              aria-label={askLabel}
              aria-describedby={
                showTooltip ? 'borjie-litfin-widget-tooltip' : undefined
              }
              title={askLabel}
            >
              <BorjieMark size={28} />
              <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 ${isFirstVisit ? '' : 'animate-ping'}`}
                />
                <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-emerald-500 border-2 border-background" />
              </span>
            </button>
          </div>
        </div>
      )}

      {hasBeenOpened && (
        <div className={isOpen ? '' : 'hidden'}>
          <LitFinChatPanel onClose={closeWidget} />
        </div>
      )}
    </WidgetErrorBoundary>
  );
}
