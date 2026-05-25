/**
 * FloatingChatWidget — the always-visible Mr. Mwikila bubble.
 *
 * Collapsed: circular FAB bottom-right with unread-count badge.
 * Expanded (desktop): 380×560 anchored bottom-right panel.
 * Mobile: bottom-sheet (full height) once viewport drops below breakpoint.
 *
 * Skips rendering entirely when the feature-flag is off so the bundle is
 * effectively zero-cost for tenants that disable it.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useOptionalBossnyumbaAI } from './BossnyumbaAIProvider';
import { ChatPanel } from './ChatPanel';

interface FloatingChatWidgetProps {
  readonly mobileBreakpoint?: number;
  readonly renderBlockSlot?: (messageId: string) => ReactNode;
}

function isMobileViewport(breakpoint: number): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
}

export function FloatingChatWidget({ mobileBreakpoint = 640, renderBlockSlot }: FloatingChatWidgetProps): JSX.Element | null {
  const ctx = useOptionalBossnyumbaAI();
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${mobileBreakpoint}px)`);
    const listener = () => setMobile(mql.matches);
    setMobile(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    }
    mql.addListener(listener);
    return () => mql.removeListener(listener);
  }, [mobileBreakpoint]);

  const expand = useCallback(() => {
    ctx?.chat.switchMode('expanded');
  }, [ctx]);

  const collapse = useCallback(() => {
    ctx?.chat.switchMode('collapsed');
  }, [ctx]);

  if (!ctx) return null;
  if (!ctx.featureEnabled) return null;

  const { chat, strings } = ctx;
  const isExpanded = chat.mode !== 'collapsed';

  if (!isExpanded) {
    return (
      <button
        type="button"
        data-testid="floating-chat-bubble"
        aria-label={strings.expand}
        onClick={expand}
        style={{
          position: 'fixed',
          bottom: mobile ? 80 : 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 999,
          background: '#0f172a',
          color: '#f8fafc',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 12px 24px rgba(15, 23, 42, 0.3)',
          fontSize: 18,
          fontWeight: 600,
          zIndex: 10_000,
        }}
      >
        <span aria-hidden="true">MM</span>
        {chat.unreadCount > 0 ? (
          <span
            data-testid="floating-chat-unread"
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              background: '#dc2626',
              color: '#fff',
              borderRadius: 999,
              minWidth: 20,
              height: 20,
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
            }}
          >
            {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
          </span>
        ) : null}
      </button>
    );
  }

  const variant = mobile ? 'bottom-sheet' : 'floating';
  return <ChatPanel chat={chat} strings={strings} onClose={collapse} variant={variant} renderBlockSlot={renderBlockSlot} />;
}

export { isMobileViewport as __isMobileViewport };
