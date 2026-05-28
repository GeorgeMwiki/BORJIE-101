'use client';

import { Sparkles } from 'lucide-react';

/**
 * PersonaGreeting — the bilingual welcome shown above the composer when
 * the admin operator first lands on the chat-first home. Suggestion
 * chips below the greeting seed the composer with one of the four
 * high-leverage admin prompts (tenant lookup, kill-switch state,
 * Sentry pilot errors, audit-chain integrity).
 *
 * Voice is Swahili-first by global rule. The English subtitle follows so
 * non-Swahili HQ staff are not blocked. Chips are tap targets large
 * enough for mobile (40px+ height via py-2 + text size).
 */

export interface SuggestionChip {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

export const ADMIN_SUGGESTIONS: ReadonlyArray<SuggestionChip> = [
  {
    id: 'tenants-recent',
    label: 'Onyesha tenants 10 wapya',
    prompt: 'Onyesha tenants 10 wapya waliojiunga wiki hii. Orodhesha kwa tarehe ya kujisajili.',
  },
  {
    id: 'killswitch',
    label: 'Kill-switch hali',
    prompt: 'Kill-switch iko hali gani sasa? Onyesha mabadiliko ya hivi karibuni na mtu aliyebadilisha.',
  },
  {
    id: 'sentry-pilot',
    label: 'Sentry pilot errors leo',
    prompt: 'Sentry errors za pilot tenants leo. Group by error code na onyesha frequency.',
  },
  {
    id: 'audit-integrity',
    label: 'Audit chain integrity',
    prompt: 'Hakikisha audit chain integrity. Je, kuna hash mismatches au gaps katika sequence ya leo?',
  },
];

interface PersonaGreetingProps {
  readonly onSuggest: (prompt: string) => void;
  readonly disabled?: boolean;
}

export function PersonaGreeting({
  onSuggest,
  disabled,
}: PersonaGreetingProps) {
  return (
    <section
      className="mx-auto max-w-prose-md space-y-5 px-4 py-12 text-center"
      data-testid="home-chat-greeting"
      aria-label="Admin greeting"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/30 bg-signal-500/10 px-3 py-1 text-caption uppercase tracking-widest text-signal-500">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        T2 admin strategist
      </div>

      <div className="space-y-2">
        <h1 className="font-display text-4xl leading-tight text-foreground">
          Welcome to Borjie internal.
        </h1>
        <p className="text-base text-neutral-400">
          Niambie unahitaji nini. Investigate tenants, dispatch jobs, query data —
          one chat, every surface.
        </p>
      </div>

      <ul
        className="mx-auto flex flex-wrap justify-center gap-2 pt-2"
        aria-label="Suggested admin prompts"
      >
        {ADMIN_SUGGESTIONS.map((chip) => (
          <li key={chip.id}>
            <button
              type="button"
              data-testid={`home-chat-chip-${chip.id}`}
              disabled={disabled}
              onClick={() => onSuggest(chip.prompt)}
              className="rounded-full border border-border bg-surface/40 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-signal-500/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {chip.label}
            </button>
          </li>
        ))}
      </ul>

      <p className="pt-4 text-tiny uppercase tracking-widest text-neutral-500">
        Wire · POST /api/v1/brain/turn · persona T2_admin_strategist
      </p>
    </section>
  );
}
