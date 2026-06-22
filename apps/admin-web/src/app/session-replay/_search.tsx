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
 * Rendered on the DS `Input` + semantic tokens. SINGLE LANGUAGE PER LOCALE
 * (canon): copy resolves to the active locale via `pickByLocale`.
 */

'use client';

import { useEffect, useState } from 'react';
import { Input, Button } from '@borjie/design-system';
import { useLocale, pickByLocale } from '@/lib/locale';

interface SessionReplaySearchProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly debounceMs?: number;
  readonly placeholder?: string;
}

const DEFAULT_DEBOUNCE_MS = 250;

const S = {
  label: { en: 'Search sessions', sw: 'Tafuta vipindi' },
  placeholder: {
    en: 'Search by session id, user, surface, or tenant…',
    sw: 'Tafuta kwa kitambulisho cha kipindi, mtumiaji, uso, au mteja…',
  },
  clear: { en: 'Clear', sw: 'Futa' },
  clearAria: { en: 'Clear search', sw: 'Futa utafutaji' },
} as const;

export function SessionReplaySearch({
  value,
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  placeholder,
}: SessionReplaySearchProps): JSX.Element {
  const locale = useLocale();
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
    <div className="flex w-full max-w-md items-center gap-2">
      <label htmlFor="session-replay-search" className="sr-only">
        {pickByLocale(locale, S.label)}
      </label>
      <Input
        id="session-replay-search"
        type="search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder ?? pickByLocale(locale, S.placeholder)}
        autoComplete="off"
        spellCheck={false}
        className="w-full"
      />
      {local.length > 0 ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => {
            setLocal('');
            onChange('');
          }}
          className="h-auto p-0 text-xs"
          aria-label={pickByLocale(locale, S.clearAria)}
        >
          {pickByLocale(locale, S.clear)}
        </Button>
      ) : null}
    </div>
  );
}
