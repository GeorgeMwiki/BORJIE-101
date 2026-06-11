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

import { useMemo, useRef } from 'react';
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
 * Content-complexity tiers and their target reveal cadence (words/sec).
 * Slower for dense content (more glance-back, more cognitive load),
 * faster for plain prose. Mining + Swahili default prose sits at the
 * medium tier — long agglutinative tokens read best a touch under the
 * simple rate.
 */
const WPS_TECHNICAL = 12; // code / tables / dense identifiers
const WPS_MEDIUM = 15; // default: mining prose, Swahili, mixed
const WPS_SIMPLE = 20; // short, plain, conversational
/** Fallback when we cannot measure word length (empty slice). */
const ASSUMED_CHARS_PER_WORD = 6;

type ComplexityTier = 'technical' | 'medium' | 'simple';

/**
 * Cheap, allocation-light classifier over a text sample. Detects
 * code/technical density vs plain prose; everything else is medium.
 * Pure + deterministic so it is safe to memoise on `text`.
 */
function classifyComplexity(sample: string): ComplexityTier {
  if (sample.length === 0) return 'medium';
  // Code fences / inline code / tables / heavy punctuation → technical.
  const hasCodeFence = sample.includes('```');
  const technicalSymbols = (sample.match(/[{}();<>|/\\=_]|`|\$\$|\|\s/g) ?? []).length;
  const symbolDensity = technicalSymbols / sample.length;
  if (hasCodeFence || symbolDensity > 0.06) return 'technical';

  // Long average word + low symbol density reads as plain prose → simple.
  const words = sample.split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    const avgWordLen =
      words.reduce((sum, w) => sum + w.length, 0) / words.length;
    // Very short words, little punctuation → conversational/simple.
    if (avgWordLen <= 5 && symbolDensity < 0.02) return 'simple';
  }
  return 'medium';
}

function wpsForTier(tier: ComplexityTier): number {
  if (tier === 'technical') return WPS_TECHNICAL;
  if (tier === 'simple') return WPS_SIMPLE;
  return WPS_MEDIUM;
}

/**
 * Derive a chars/sec baseline for the smooth cursor from a words/sec
 * target. We measure the *actual* average word length of the sample so
 * Swahili's longer tokens don't read slower than intended at a given
 * wps — a 15 wps target on 8-char words yields a higher chars/sec than
 * on 4-char words, keeping the *word* cadence steady.
 */
function adaptiveCharsPerSec(sample: string): number {
  const tier = classifyComplexity(sample);
  const wps = wpsForTier(tier);
  const words = sample.split(/\s+/).filter(Boolean);
  const avgWordLen =
    words.length > 0
      ? words.reduce((sum, w) => sum + w.length, 0) / words.length
      : ASSUMED_CHARS_PER_WORD - 1;
  // +1 for the inter-word space that the cursor must also traverse.
  const charsPerWord = avgWordLen + 1;
  return wps * charsPerWord;
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
  // Adaptive cadence: recompute the reveal baseline as the content grows,
  // but only re-classify on coarse length steps so we don't thrash the
  // baseline every token (which would re-run the cursor effect each frame).
  const complexitySample = useMemo(
    () => text.slice(0, 600),
    // Re-sample on coarse 80-char growth buckets — stable mid-stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text.length === 0 ? 0 : Math.ceil(Math.min(text.length, 600) / 80)],
  );
  const baselineCharsPerSec = useMemo(
    () => adaptiveCharsPerSec(complexitySample),
    [complexitySample],
  );

  const { visibleText } = useSmoothText(text, status, baselineCharsPerSec);
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
      aria-live="polite"
      aria-atomic="false"
      aria-busy={status === 'streaming'}
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
