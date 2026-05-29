'use client';

/**
 * Composer input with ghost-text completion overlay — Roadmap R9.
 *
 * Renders a single-line input with the user's typed text plus a dim
 * ghost suggestion appended. Tab accepts the suggestion; any other
 * keystroke or backspace cancels it. Pure presentational on top of
 * `useGhostCompletion`.
 */

import {
  useCallback,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { useGhostCompletion } from './useGhostCompletion';

export interface GhostCompletionInputProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder?: string;
  readonly language?: 'sw' | 'en';
  readonly className?: string;
  readonly disabled?: boolean;
}

export function GhostCompletionInput({
  value,
  onChange,
  placeholder,
  language = 'sw',
  className,
  disabled,
}: GhostCompletionInputProps) {
  const suggestion = useGhostCompletion(value, { language });
  const [hovering, setHovering] = useState<boolean>(false);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Tab' && suggestion.length > 0) {
        event.preventDefault();
        onChange(`${value}${suggestion}`);
      }
    },
    [onChange, suggestion, value],
  );

  return (
    <div
      className={`relative ${className ?? ''}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Overlay layer — dim ghost text behind the real input. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center px-3 text-sm"
      >
        <span className="invisible whitespace-pre">{value}</span>
        {suggestion ? (
          <span className="whitespace-pre text-neutral-500">{suggestion}</span>
        ) : null}
      </div>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className="relative w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-neutral-600 disabled:opacity-40"
      />
      {suggestion && hovering ? (
        <div className="absolute -bottom-5 right-0 text-xxs text-neutral-500">
          Tab to accept / Tab kukubali
        </div>
      ) : null}
    </div>
  );
}
