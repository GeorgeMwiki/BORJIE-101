/**
 * Session-replay search input — Central Command Phase C (C4).
 *
 * Free-text search box that filters the session list by user email,
 * session id, surface, or tenant name. Debounced 250 ms so the
 * client-side `filterSessions` reducer doesn't fire on every keystroke
 * (still fast — the list is at most ~500 rows — but the debounce keeps
 * the rendered table calm).
 *
 * Pure presentational; all filtering happens upstream in the host page.
 */

'use client';

import { useEffect, useState } from 'react';

interface SessionReplaySearchProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly debounceMs?: number;
  readonly placeholder?: string;
}

const DEFAULT_DEBOUNCE_MS = 250;

export function SessionReplaySearch({
  value,
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  placeholder = 'Search by session id, user, surface, or tenant…',
}: SessionReplaySearchProps): JSX.Element {
  const [local, setLocal] = useState(value);

  // Sync external resets (e.g. "Clear filters" button) back into the
  // local box without disturbing the debounce timer.
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Debounce — only forward the value after the user has paused typing.
  useEffect(() => {
    if (local === value) return;
    const timer = setTimeout(() => onChange(local), debounceMs);
    return () => clearTimeout(timer);
  }, [local, value, debounceMs, onChange]);

  return (
    <div className="flex items-center gap-2 w-full max-w-md">
      <label htmlFor="session-replay-search" className="sr-only">
        Search sessions
      </label>
      <input
        id="session-replay-search"
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-signal-500 focus:outline-none focus:ring-1 focus:ring-signal-500"
      />
      {local.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            setLocal('');
            onChange('');
          }}
          className="text-xs text-neutral-400 hover:text-neutral-200"
          aria-label="Clear search"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
