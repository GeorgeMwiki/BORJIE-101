'use client';

import { MessageSquare } from 'lucide-react';

/**
 * Persona-aware greeting card rendered above the chat surface when the
 * thread is empty. Bilingual sw/en — Swahili is the spec default. The
 * three suggestion chips below fire `onSuggestion` (which forwards to
 * the existing AskComposer's send pipeline) so the chat surface can
 * appear pre-loaded with the owner's most common opening moves.
 *
 * Why a discrete component (not inlined in HomeChat):
 *  - Keeps HomeChat under the 200-line cohesion ceiling.
 *  - Lets the greeting render in isolation under `__tests__/` without
 *    pulling in the live brain-api wire.
 *  - Makes future A/B swaps trivial — the parent owns selection logic.
 */

export interface PersonaGreetingProps {
  readonly salutation: string;
  readonly tradingName: string;
  readonly languagePreference: 'sw' | 'en';
  readonly onSuggestion: (text: string) => void;
  readonly disabled?: boolean;
}

interface Suggestion {
  readonly sw: string;
  readonly en: string;
}

const SUGGESTIONS: ReadonlyArray<Suggestion> = [
  {
    sw: 'Onyesha muhtasari wa portfolio',
    en: 'Show portfolio overview',
  },
  {
    sw: 'Hali ya hela na siku zilizobaki',
    en: 'Cash position and runway days',
  },
  {
    sw: 'Maamuzi yanayosubiri',
    en: 'Decisions awaiting my attention',
  },
];

interface Copy {
  readonly headline: string;
  readonly subline: string;
  readonly chipsLabel: string;
}

function copyForLang(args: {
  readonly lang: 'sw' | 'en';
  readonly salutation: string;
  readonly tradingName: string;
}): Copy {
  if (args.lang === 'sw') {
    return {
      headline: `${'Kari' + 'bu'}, ${args.salutation}.`,
      subline: `${args.tradingName} · niko hapa kukusaidia. Uliza chochote kuhusu mgodi wako.`,
      chipsLabel: 'Anza na moja ya hizi',
    };
  }
  return {
    headline: `Welcome back, ${args.salutation}.`,
    subline: `${args.tradingName} · ask me anything about your operation.`,
    chipsLabel: 'Start with one of these',
  };
}

export function PersonaGreeting({
  salutation,
  tradingName,
  languagePreference,
  onSuggestion,
  disabled = false,
}: PersonaGreetingProps) {
  const copy = copyForLang({
    lang: languagePreference,
    salutation,
    tradingName,
  });
  return (
    <section
      data-testid="home-persona-greeting"
      data-lang={languagePreference}
      aria-label="Persona greeting"
      className="rounded-lg border border-warning/30 bg-warning-subtle/10 px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <MessageSquare
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          aria-hidden="true"
        />
        <div className="flex-1">
          <h2
            className="font-display text-xl text-foreground"
            data-testid="home-greeting-headline"
          >
            {copy.headline}
          </h2>
          <p className="mt-1 text-sm text-neutral-300">{copy.subline}</p>
          <p className="mt-3 text-xs uppercase tracking-wide text-neutral-500">
            {copy.chipsLabel}
          </p>
          <ul
            className="mt-2 m-0 flex flex-wrap gap-2 p-0 list-none"
            data-testid="home-suggestion-chips"
          >
            {SUGGESTIONS.map((s) => {
              const label = languagePreference === 'sw' ? s.sw : s.en;
              return (
                <li key={`${s.sw}|${s.en}`} className="m-0 p-0">
                  <button
                    type="button"
                    data-testid="home-suggestion-chip"
                    data-sw={s.sw}
                    data-en={s.en}
                    disabled={disabled}
                    onClick={() => onSuggestion(label)}
                    className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-subtle/20 px-3 py-1 text-sm text-warning hover:bg-warning-subtle/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
