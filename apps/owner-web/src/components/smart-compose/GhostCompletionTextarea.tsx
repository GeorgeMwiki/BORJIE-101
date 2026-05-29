'use client';

/**
 * Multi-line composer with ghost-text completion overlay — R-FUTURE-2.
 *
 * v2 of `GhostCompletionInput` that lifts the single-line `<input>`
 * into a `<textarea>` with three pieces of state the input version
 * skipped:
 *
 *   1. Synchronised scroll — the overlay layer mirrors the textarea's
 *      `scrollTop` / `scrollLeft` so ghost text stays attached to the
 *      caret even after the user has scrolled.
 *   2. Line wrap — both layers share font + width so the suggestion
 *      wraps where the user's text wraps. The overlay re-renders the
 *      same whitespace as the textarea (`whitespace-pre-wrap`).
 *   3. IME composition handling — Chinese / Japanese / Swahili-tonal
 *      input composes via the `compositionstart` / `compositionend`
 *      events. We suppress the suggestion while composition is in
 *      progress so the IME's own candidate popup doesn't fight the
 *      ghost overlay.
 *
 * Tab accepts. Escape cancels (clears the local suggestion override
 * until the next keystroke produces a new fetch). Any other keystroke
 * cancels passively (the next debounce tick re-fetches).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import { useGhostCompletion } from './useGhostCompletion';

export interface GhostCompletionTextareaProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder?: string;
  readonly language?: 'sw' | 'en';
  readonly className?: string;
  readonly disabled?: boolean;
  /** Rows — passes through to the underlying `<textarea>`. Default 4. */
  readonly rows?: number;
  /** Test seam — inject a fetcher into the underlying hook. */
  readonly fetcher?: typeof fetch;
}

export function GhostCompletionTextarea({
  value,
  onChange,
  placeholder,
  language = 'sw',
  className,
  disabled,
  rows = 4,
  fetcher,
}: GhostCompletionTextareaProps) {
  const fetched = useGhostCompletion(value, {
    language,
    ...(fetcher ? { fetcher } : {}),
  });
  // Local suppression flag — Escape clears the suggestion until the
  // next keystroke. We track it locally because the hook always
  // returns the latest fetched suggestion.
  const [suppressed, setSuppressed] = useState<boolean>(false);
  const [composing, setComposing] = useState<boolean>(false);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const suggestion = suppressed || composing ? '' : fetched;

  // Reset the suppression flag every time the user types — they want
  // suggestions back on for the next pass.
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (suppressed) setSuppressed(false);
      onChange(event.target.value);
    },
    [onChange, suppressed],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // IME composition — let the browser handle it.
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Tab' && suggestion.length > 0) {
        event.preventDefault();
        onChange(`${value}${suggestion}`);
        return;
      }
      if (event.key === 'Escape' && suggestion.length > 0) {
        event.preventDefault();
        setSuppressed(true);
      }
    },
    [onChange, suggestion, value],
  );

  const handleScroll = useCallback((event: UIEvent<HTMLTextAreaElement>) => {
    const ta = event.currentTarget;
    setScrollTop(ta.scrollTop);
    setScrollLeft(ta.scrollLeft);
  }, []);

  const handleCompositionStart = useCallback(
    (_event: CompositionEvent<HTMLTextAreaElement>) => {
      setComposing(true);
    },
    [],
  );

  const handleCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLTextAreaElement>) => {
      setComposing(false);
      // The composition's final value lands via the next change event,
      // but echoing here lets the host state-machine catch up earlier
      // when wrapped inside a Hangul / Kana IME on Safari.
      const native = event.currentTarget.value;
      if (native !== value) onChange(native);
    },
    [onChange, value],
  );

  // Hot-swap the overlay scroll whenever the textarea programmatically
  // scrolls (e.g. when the value grows past the visible viewport).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    setScrollTop(ta.scrollTop);
    setScrollLeft(ta.scrollLeft);
  }, [value]);

  // The overlay + textarea share these classes so font / padding /
  // line-height / width line up to the pixel. Any tweak here MUST be
  // mirrored in both elements; the comment above the textarea spells
  // this rule out.
  const sharedTypography =
    'block w-full whitespace-pre-wrap break-words px-3 py-2 text-sm leading-relaxed font-sans';

  return (
    <div
      className={`relative ${className ?? ''}`}
      data-testid="ghost-textarea-wrapper"
    >
      {/* Overlay layer — same font + padding + width as the textarea
          so the ghost suggestion lays over the same wrapped lines. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 overflow-hidden ${sharedTypography} text-transparent`}
        style={{
          // Mirror the textarea's scroll position so the overlay tracks
          // the caret even after the user scrolls.
          transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`,
        }}
        data-testid="ghost-textarea-overlay"
      >
        {/* The user's text is rendered invisible so the suggestion
            lands at the correct wrap-aware position. */}
        <span className="invisible">{value}</span>
        {suggestion.length > 0 ? (
          <span className="text-neutral-500">{suggestion}</span>
        ) : null}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        autoComplete="off"
        spellCheck={false}
        className={`relative ${sharedTypography} rounded border border-border bg-background text-foreground placeholder:text-neutral-600 disabled:opacity-40 resize-none focus:outline-none focus:ring-1 focus:ring-signal-500`}
        data-testid="ghost-textarea-input"
      />
      {suggestion.length > 0 ? (
        <div
          className="absolute -bottom-5 right-0 text-tiny text-neutral-500"
          data-testid="ghost-textarea-hint"
        >
          {language === 'sw'
            ? 'Tab kukubali · Esc kuondoa'
            : 'Tab to accept · Esc to dismiss'}
        </div>
      ) : null}
    </div>
  );
}
