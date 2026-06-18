'use client';

import { Sparkles } from 'lucide-react';
import { pickByLocale, type Locale } from '@/lib/locale-shared';

/**
 * PersonaGreeting — the welcome shown above the composer when the admin
 * operator first lands on the chat-first home. Suggestion chips below the
 * greeting seed the composer with one of the four high-leverage admin
 * prompts (tenant lookup, kill-switch state, Sentry pilot errors,
 * audit-chain integrity).
 *
 * Persona role: Mr. Mwikila — AI Platform Director (Borjie HQ fleet of
 * tenants). See `Docs/RESEARCH/CHAT_FIRST_SOTA.md` §Principle 2 for the
 * cross-surface role-variant matrix.
 *
 * SINGLE LANGUAGE PER LOCALE (canon): every rendered string — heading,
 * subtitle, persona pill, and chip labels/prompts — resolves to the
 * server-resolved active locale via `pickByLocale`. When `en` is active
 * ZERO Swahili tokens appear; when `sw` is active ZERO English tokens
 * appear. The previous build hard-mixed an English heading with a Swahili
 * subtitle and Swahili-only chips, which violated the canon.
 *
 * The greeting line is TIME-AWARE per the CHAT-FIRST manifesto — it
 * picks "Good morning / afternoon / evening" from Africa/Dar_es_Salaam
 * local time. To keep SSR and the first client render byte-identical
 * (avoiding a React #418 hydration-text mismatch), the time-of-day word
 * is resolved on the client AFTER mount via `useTimeGreeting`; the
 * server renders a neutral, time-free welcome and the time-aware variant
 * swaps in once hydrated.
 */

import { useEffect, useState } from 'react';

export interface SuggestionChip {
  readonly id: string;
  /** English label — rendered when the active locale is `en`. */
  readonly label: string;
  /** Swahili label — rendered when the active locale is `sw`. */
  readonly labelSw: string;
  /** English seed prompt — sent to the brain when the active locale is `en`. */
  readonly prompt: string;
  /** Swahili seed prompt — sent to the brain when the active locale is `sw`. */
  readonly promptSw: string;
}

export const ADMIN_SUGGESTIONS: ReadonlyArray<SuggestionChip> = [
  {
    id: 'tenants-recent',
    label: 'Show the 10 newest tenants',
    labelSw: 'Onyesha tenants 10 wapya',
    prompt:
      'Show the 10 newest tenants that joined this week. List them by sign-up date.',
    promptSw:
      'Onyesha tenants 10 wapya waliojiunga wiki hii. Orodhesha kwa tarehe ya kujisajili.',
  },
  {
    id: 'killswitch',
    label: 'Kill-switch state',
    labelSw: 'Kill-switch hali',
    prompt:
      'What is the kill-switch state right now? Show the most recent change and who made it.',
    promptSw:
      'Kill-switch iko hali gani sasa? Onyesha mabadiliko ya hivi karibuni na mtu aliyebadilisha.',
  },
  {
    id: 'sentry-pilot',
    label: 'Sentry pilot errors today',
    labelSw: 'Sentry pilot errors leo',
    prompt:
      'Sentry errors for pilot tenants today. Group by error code and show frequency.',
    promptSw:
      'Sentry errors za pilot tenants leo. Group by error code na onyesha frequency.',
  },
  {
    id: 'audit-integrity',
    label: 'Audit chain integrity',
    labelSw: 'Audit chain integrity',
    prompt:
      'Verify audit chain integrity. Are there any hash mismatches or gaps in today’s sequence?',
    promptSw:
      'Hakikisha audit chain integrity. Je, kuna hash mismatches au gaps katika sequence ya leo?',
  },
];

/**
 * Pick a time-aware greeting word for Africa/Dar_es_Salaam in the active
 * locale. Exposed for testability. NEVER mixes languages — both branches
 * return a single-locale string.
 */
export function pickTimeGreeting(
  locale: Locale,
  now: Date = new Date(),
): string {
  const hourInTz = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Africa/Dar_es_Salaam',
    }).format(now),
  );
  const slot: 'morning' | 'afternoon' | 'evening' =
    hourInTz >= 5 && hourInTz < 12
      ? 'morning'
      : hourInTz >= 12 && hourInTz < 18
        ? 'afternoon'
        : 'evening';
  return pickByLocale(locale, {
    en: {
      morning: 'Good morning',
      afternoon: 'Good afternoon',
      evening: 'Good evening',
    },
    sw: {
      morning: 'Habari za asubuhi',
      afternoon: 'Habari za mchana',
      evening: 'Habari za jioni',
    },
  })[slot];
}

/**
 * Resolve the time-aware greeting word on the CLIENT only, after mount.
 * Returns `null` on the server and the first client render so SSR markup
 * matches the initial client markup (no React #418). Once mounted, the
 * time-of-day word is computed and swapped in.
 */
function useTimeGreeting(locale: Locale): string | null {
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(pickTimeGreeting(locale));
  }, [locale]);
  return greeting;
}

interface PersonaGreetingProps {
  readonly onSuggest: (prompt: string) => void;
  readonly disabled?: boolean;
  /** Active locale (server-resolved). Every string renders in this locale. */
  readonly locale?: Locale;
}

export function PersonaGreeting({
  onSuggest,
  disabled,
  locale = 'en',
}: PersonaGreetingProps) {
  // Time-free welcome for SSR + first client render; the time-aware
  // variant swaps in after hydration. Both are single-locale.
  const timeGreeting = useTimeGreeting(locale);
  const heading =
    timeGreeting === null
      ? pickByLocale(locale, {
          en: 'Welcome. I am Mr. Mwikila.',
          sw: 'Karibu. Mimi ni Mr. Mwikila.',
        })
      : pickByLocale(locale, {
          en: `${timeGreeting}. I am Mr. Mwikila.`,
          sw: `${timeGreeting}. Mimi ni Mr. Mwikila.`,
        });

  return (
    <section
      className="mx-auto max-w-prose-md space-y-5 px-4 py-12 text-center"
      data-testid="home-chat-greeting"
      aria-label="Admin greeting"
    >
      <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/30 bg-signal-500/10 px-3 py-1 text-caption uppercase tracking-widest text-signal-500">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        {pickByLocale(locale, {
          en: 'AI Platform Director',
          sw: 'Mkurugenzi wa Jukwaa la AI',
        })}
      </div>

      <div className="space-y-2">
        <h1 className="font-display text-4xl leading-tight text-foreground">
          {heading}
        </h1>
        <p className="text-base text-neutral-400">
          {pickByLocale(locale, {
            en: 'Tell me what you need — cross-tenant rollups, audit queries, fleet health, kill-switch proposals. One chat, every tenant.',
            sw: 'Niambie unahitaji nini — muhtasari wa tenants wote, maswali ya ukaguzi, afya ya jukwaa, mapendekezo ya kill-switch. Gumzo moja, kila tenant.',
          })}
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
              onClick={() =>
                onSuggest(pickByLocale(locale, { en: chip.prompt, sw: chip.promptSw }))
              }
              className="rounded-full border border-border bg-surface/40 px-3 py-2 text-xs text-neutral-300 transition-colors hover:border-signal-500/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pickByLocale(locale, { en: chip.label, sw: chip.labelSw })}
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
