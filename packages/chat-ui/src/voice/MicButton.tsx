/**
 * MicButton — minimal toggle button for voice input.
 *
 * Headless-ish: SVG mic icon inline (no icon-lib dep), tailwind classes
 * for default/listening states. Visual styling is intentionally
 * conservative — calling apps can override via `className`.
 */

import * as React from 'react';

export interface MicButtonProps {
  /** True while STT is recording. Drives icon + pulse state. */
  readonly isListening: boolean;
  /** Begin a listening session. */
  onStart(): void;
  /** End the current listening session. */
  onStop(): void;
  /** Optional className passthrough for tailwind classes. */
  readonly className?: string;
  /** Optional aria-label override. */
  readonly ariaLabel?: string;
  /** Disable interaction (e.g. while STT unsupported). */
  readonly disabled?: boolean;
}

export function MicButton(props: MicButtonProps): JSX.Element {
  const {
    isListening,
    onStart,
    onStop,
    className,
    ariaLabel,
    disabled = false,
  } = props;

  function handleClick(): void {
    if (disabled) return;
    if (isListening) onStop();
    else onStart();
  }

  const baseClasses =
    'inline-flex items-center justify-center rounded-full border border-border bg-surface px-3 py-2 text-foreground transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50';
  const listeningClasses = isListening
    ? 'bg-primary text-primary-foreground hover:bg-primary border-primary animate-pulse'
    : '';
  const composed = [baseClasses, listeningClasses, className].filter(Boolean).join(' ');

  const label = ariaLabel ?? (isListening ? 'Stop listening' : 'Start voice input');

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={isListening}
      title={label}
      className={composed}
    >
      <MicIcon listening={isListening} />
    </button>
  );
}

function MicIcon({ listening }: { listening: boolean }): JSX.Element {
  // 16x16 mic glyph; stroke-based so it inherits currentColor.
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
      {listening ? <circle cx="20" cy="4" r="2" fill="currentColor" stroke="none" /> : null}
    </svg>
  );
}
