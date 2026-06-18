'use client';

/**
 * JumpToLatestPill — a floating "Jump to latest" control shown bottom-center
 * (above the composer) only when the user has scrolled up away from a growing
 * transcript. Clicking it re-anchors to the bottom and re-engages auto-follow
 * (see `useChatScroll`).
 *
 * Promoted from apps/owner-web's home-chat pill so every Borjie chat surface
 * shares one control. Self-contained: the label is inlined per locale (single
 * language per active locale, no cross-language fallback) so the package owns
 * no app-local i18n dependency. No em-dashes in user-facing copy.
 */

import type { JSX } from 'react';
import { ArrowDown } from 'lucide-react';

const PILL_LABEL = {
  en: 'Jump to latest',
  sw: 'Rukia ya hivi punde',
} as const;

export interface JumpToLatestPillProps {
  readonly visible: boolean;
  readonly language: 'sw' | 'en';
  readonly onClick: () => void;
}

export function JumpToLatestPill({
  visible,
  language,
  onClick,
}: JumpToLatestPillProps): JSX.Element | null {
  if (!visible) return null;
  const label = PILL_LABEL[language];
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        data-testid="chat-jump-to-latest"
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur transition-colors hover:bg-background"
      >
        <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 text-primary" />
        {label}
      </button>
    </div>
  );
}
