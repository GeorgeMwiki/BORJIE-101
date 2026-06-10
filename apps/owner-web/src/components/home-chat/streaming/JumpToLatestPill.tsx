'use client';

/**
 * JumpToLatestPill — a floating "Jump to latest" control shown bottom-center
 * (above the composer) only when the owner has scrolled up away from a
 * growing transcript. Clicking it re-anchors to the bottom and re-engages
 * auto-follow (see use-scroll-anchor).
 *
 * Localised EN/SW (single language per active locale). Honours focus-visible
 * rings via the global :focus-visible rule. The mount/unmount fade rides the
 * design-system `animate-fade-up` (≤ 300ms, reduced-motion safe).
 */

import type { ReactElement } from 'react';
import { ArrowDown } from 'lucide-react';

export interface JumpToLatestPillProps {
  readonly visible: boolean;
  readonly languagePreference: 'sw' | 'en';
  readonly onClick: () => void;
}

export function JumpToLatestPill({
  visible,
  languagePreference,
  onClick,
}: JumpToLatestPillProps): ReactElement | null {
  if (!visible) return null;
  const label =
    languagePreference === 'sw' ? 'Nenda kwa za hivi karibuni' : 'Jump to latest';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
      <button
        type="button"
        onClick={onClick}
        data-testid="home-chat-jump-to-latest"
        className="animate-fade-up pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur transition-colors hover:bg-surface"
      >
        <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 text-warning" />
        {label}
      </button>
    </div>
  );
}
