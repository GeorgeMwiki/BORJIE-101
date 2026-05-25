'use client';

import { useState } from 'react';

interface LanguageToggleProps {
  readonly initial: 'sw' | 'en';
}

/**
 * Swahili / English toggle.
 *
 * Swahili is the spec default — the majority of owners and 100% of
 * site-level workers operate in Swahili. The toggle is presented as
 * a two-position pill so the active language is always visible
 * (vs. a hidden dropdown that hides the current state).
 *
 * Persists to the session cookie via api-sdk in the real impl;
 * local state for now so layouts can be screenshotted today.
 */
export function LanguageToggle({ initial }: LanguageToggleProps) {
  const [lang, setLang] = useState<'sw' | 'en'>(initial);
  return (
    <div className="inline-flex rounded-full border border-border bg-surface p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setLang('sw')}
        aria-pressed={lang === 'sw'}
        className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
          lang === 'sw'
            ? 'bg-foreground text-background'
            : 'text-neutral-400 hover:text-foreground'
        }`}
      >
        SW
      </button>
      <button
        type="button"
        onClick={() => setLang('en')}
        aria-pressed={lang === 'en'}
        className={`rounded-full px-2.5 py-1 font-medium transition-colors ${
          lang === 'en'
            ? 'bg-foreground text-background'
            : 'text-neutral-400 hover:text-foreground'
        }`}
      >
        EN
      </button>
    </div>
  );
}
