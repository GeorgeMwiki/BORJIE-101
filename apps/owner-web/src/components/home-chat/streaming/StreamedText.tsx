'use client';

/**
 * StreamedText — renders an assistant turn's text with a per-word blur-in
 * reveal *while it is streaming*, and as clean incremental Markdown once it
 * is done (or when rendered from history / scrollback).
 *
 * Reveal mechanic (HARD spec): the smooth cursor (use-smooth-text) exposes a
 * `visibleText` that catches up to the full text at ~60 chars/sec. We split
 * that into words and animate ONLY the words that became visible since the
 * last render — opacity 0→1, blur(4px)→0, translateY(4px)→0 over 200ms on the
 * `--ease-out` curve, `animation-fill-mode: forwards` so a revealed word stays
 * put and is never re-animated. The whole message never re-animates on a new
 * chunk; only the freshly-revealed tail words do.
 *
 * Lifecycle:
 *   - streaming → animated word reveal of `visibleText` (the catching-up slice).
 *   - complete / stopped / history → the full text via <IncrementalMarkdown>,
 *     no animation, parsed once.
 *   - reduced-motion → handled by the @keyframes (instant full opacity, no
 *     blur) AND by use-smooth-text snapping the cursor to the end.
 *
 * Keeping the streaming path as plain word-spans (not Markdown) avoids
 * re-parsing Markdown on every frame; the moment the turn finalizes we swap to
 * the structured Markdown render exactly once.
 */

import { useRef } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@borjie/design-system';
import { useSmoothText, type SmoothStatus } from './use-smooth-text';
import { IncrementalMarkdown } from './incremental-markdown';

export interface StreamedTextProps {
  readonly text: string;
  readonly status: SmoothStatus;
  readonly className?: string;
}

interface WordToken {
  readonly text: string;
  readonly key: number;
}

/**
 * Tokenise into words+trailing-whitespace so we can wrap each word in an
 * animatable span while preserving the original spacing exactly.
 */
function toWords(value: string): ReadonlyArray<WordToken> {
  if (value.length === 0) return [];
  const out: WordToken[] = [];
  // Match a run of non-space followed by its trailing whitespace (incl. \n).
  const re = /\S+\s*|\s+/g;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(value)) !== null) {
    out.push({ text: m[0], key });
    key += 1;
  }
  return out;
}

export function StreamedText({
  text,
  status,
  className,
}: StreamedTextProps): ReactElement {
  const { visibleText } = useSmoothText(text, status);
  // Remember how many words were already revealed so only NEW words animate.
  const revealedCountRef = useRef(0);

  // Finalized / history → render structured Markdown once, no animation.
  if (status !== 'streaming') {
    revealedCountRef.current = 0;
    return (
      <IncrementalMarkdown
        text={text}
        className={cn('whitespace-normal', className)}
      />
    );
  }

  const words = toWords(visibleText);
  const prevRevealed = revealedCountRef.current;
  // Words at index >= prevRevealed are newly revealed this paint → animate.
  revealedCountRef.current = words.length;

  return (
    <div
      className={cn(
        'whitespace-pre-wrap text-[0.9375rem] leading-[1.6] text-foreground',
        className,
      )}
      data-testid="streamed-text"
    >
      {words.map((word, idx) =>
        idx >= prevRevealed ? (
          <span
            key={word.key}
            className="home-chat-word-in inline whitespace-pre-wrap"
          >
            {word.text}
          </span>
        ) : (
          <span key={word.key} className="inline whitespace-pre-wrap">
            {word.text}
          </span>
        ),
      )}
    </div>
  );
}
