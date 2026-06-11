'use client';

/**
 * MessageActions — the per-message action row for a completed assistant turn:
 * Copy and Regenerate. Rendered by <MessageBubble> after the text (hover-
 * reveal on desktop via the parent's `group-hover`, always-visible on mobile).
 *
 * Copy writes the raw answer text to the clipboard with a brief "copied"
 * confirmation; the icon swaps to a check for 1.5s. Regenerate is optional —
 * when wired, it re-asks the same question.
 *
 * Localised EN/SW labels (single language per active locale). Buttons carry
 * accessible names and focus-visible rings via the global rule.
 */

import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { Copy, Check, RotateCcw } from 'lucide-react';

export interface MessageActionsProps {
  readonly text: string;
  readonly languagePreference: 'sw' | 'en';
  /** When provided, renders a Regenerate button that re-asks the question. */
  readonly onRegenerate?: () => void;
}

export function MessageActions({
  text,
  languagePreference,
  onRegenerate,
}: MessageActionsProps): ReactElement {
  const [copied, setCopied] = useState(false);

  const copyLabel = languagePreference === 'sw' ? 'Nakili' : 'Copy';
  const copiedLabel = languagePreference === 'sw' ? 'Imenakiliwa' : 'Copied';
  const regenLabel =
    languagePreference === 'sw' ? 'Zalisha upya' : 'Regenerate';

  const onCopy = useCallback(async (): Promise<void> => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied (permissions / insecure context) — fail quietly;
      // the answer text remains selectable in the transcript.
    }
  }, [text]);

  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={copied ? copiedLabel : copyLabel}
        data-testid="home-chat-copy"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-neutral-400 transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        {copied ? (
          <Check aria-hidden="true" className="h-3 w-3 text-success" />
        ) : (
          <Copy aria-hidden="true" className="h-3 w-3" />
        )}
        <span>{copied ? copiedLabel : copyLabel}</span>
      </button>
      {onRegenerate ? (
        <button
          type="button"
          onClick={onRegenerate}
          aria-label={regenLabel}
          data-testid="home-chat-regenerate"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-neutral-400 transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <RotateCcw aria-hidden="true" className="h-3 w-3" />
          <span>{regenLabel}</span>
        </button>
      ) : null}
    </span>
  );
}
