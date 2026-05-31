'use client';

/**
 * Wave SUPERPOWERS (admin-web) — highlight overlay.
 *
 * Listens for `borjie:admin:highlight` events (published by the chip
 * dispatcher or any inline action) and renders a coloured halo around
 * the first DOM node that matches the `selector` for `ttl` ms.
 *
 * Tone maps to a Borjie border colour: info · success · warning ·
 * critical. The overlay is fixed-positioned and pointer-events:none so
 * it never intercepts clicks against the highlighted node.
 */

import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { ADMIN_HIGHLIGHT_EVENT_NAME, type HighlightEvent } from './bus';

interface HighlightOverlay {
  readonly rect: { x: number; y: number; w: number; h: number };
  readonly tone: HighlightEvent['tone'];
  readonly message: { en: string };
}

function rectFromSelector(selector: string): DOMRect | null {
  try {
    const node = document.querySelector(selector);
    if (!node) return null;
    return node.getBoundingClientRect();
  } catch {
    return null;
  }
}

const TONE_BORDER: Record<HighlightEvent['tone'], string> = {
  info: 'border-info',
  success: 'border-success',
  warning: 'border-warning',
  critical: 'border-destructive',
};

export function AdminHighlightOverlay(): ReactElement | null {
  const [overlay, setOverlay] = useState<HighlightOverlay | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHighlight = (e: Event): void => {
      const detail = (e as CustomEvent<HighlightEvent>).detail;
      if (!detail || typeof detail.selector !== 'string') return;
      const rect = rectFromSelector(detail.selector);
      if (!rect) return;
      setOverlay({
        rect: {
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          w: rect.width,
          h: rect.height,
        },
        tone: detail.tone,
        message: { en: detail.message.en },
      });
      const ttl = Math.max(500, Math.min(detail.ttl, 30_000));
      window.setTimeout(() => setOverlay(null), ttl);
    };
    window.addEventListener(ADMIN_HIGHLIGHT_EVENT_NAME, onHighlight);
    return () =>
      window.removeEventListener(ADMIN_HIGHLIGHT_EVENT_NAME, onHighlight);
  }, []);

  if (!overlay) return null;
  return (
    <div
      aria-hidden="true"
      data-testid="admin-highlight-overlay"
      className={`pointer-events-none absolute z-40 rounded-md border-2 shadow-lg ${TONE_BORDER[overlay.tone]}`}
      style={{
        top: overlay.rect.y - 4,
        left: overlay.rect.x - 4,
        width: overlay.rect.w + 8,
        height: overlay.rect.h + 8,
      }}
    >
      <span className="absolute -top-7 left-0 rounded bg-surface px-2 py-0.5 text-tiny text-neutral-300 shadow">
        {overlay.message.en}
      </span>
    </div>
  );
}
