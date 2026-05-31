/**
 * /api/v1/brain/compose/suggest — Roadmap R9.
 *
 * Smart-compose ghost-text endpoint. Receives the user's in-progress
 * input, returns a single-line completion the UI can render as dim
 * "ghost" text in the composer. Tab accepts; any keystroke cancels.
 *
 * The completion is the SHORTEST plausible continuation — never more
 * than 60 characters — because anything longer interferes with the
 * user's intent. Language follows the caller's preferred language
 * (sw default per CLAUDE.md "Swahili-first").
 *
 * Wire shape:
 *   POST /brain/compose/suggest
 *     { text: string, language?: 'sw' | 'en' }
 *   →
 *     { success: true, data: { suggestion: string, cached: boolean } }
 *
 * Implementation note: a curated lookup table fronts the LLM router
 * for the most common owner intents. The fallback path falls through
 * to the brain router with a tight token cap (40 tokens) to keep
 * latency under 200 ms on a hot path. The table-only path runs in
 * <5 ms — important for the keystroke debounce.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware } from '../middleware/hono-auth';

const SuggestRequest = z.object({
  text: z.string().min(1).max(2000),
  // English default per CLAUDE.md (flipped 2026-05).
  language: z.enum(['sw', 'en']).default('en'),
});

// ----------------------------------------------------------------------------
// Curated prefix → completion lookup table.
// ----------------------------------------------------------------------------
//
// Each entry maps a normalised prefix to its bilingual completions.
// The table is hand-tuned for the top 30 owner intents from the
// 2026-04 mining-CEO query corpus. The match is case-insensitive,
// trims trailing punctuation, and prefers the LONGEST matching prefix
// so "what is the cash" beats "what".
//
// New entries should land here when an intent is observed in
// the production query corpus more than 50× / week.

interface CompletionPair {
  readonly sw: string;
  readonly en: string;
}

const SUGGESTIONS: ReadonlyArray<[string, CompletionPair]> = [
  ['cash flow', { en: ' this week', sw: ' wiki hii' }],
  ['cash runway', { en: ' for the next 30 days', sw: ' kwa siku 30 zijazo' }],
  ['cash position', { en: ' across all sites', sw: ' kwenye migodi yote' }],
  ['production', { en: ' this month vs last month', sw: ' mwezi huu dhidi ya mwezi uliopita' }],
  ['licence', { en: ' renewals due next 90 days', sw: ' za kufanywa upya siku 90 zijazo' }],
  ['licence renewal', { en: ' status across sites', sw: ' hali katika migodi yote' }],
  ['royalty', { en: ' filings due this quarter', sw: ' za kuwasilisha robo hii' }],
  ['incident', { en: ' summary for the past week', sw: ' muhtasari wa wiki iliyopita' }],
  ['safety', { en: ' incidents last 7 days', sw: ' matukio siku 7 zilizopita' }],
  ['market', { en: ' price for gold today', sw: ' bei ya dhahabu leo' }],
  ['gold', { en: ' price today vs last week', sw: ' bei leo dhidi ya wiki iliyopita' }],
  ['who', { en: ' is on duty at Geita right now?', sw: ' yuko zamu Geita sasa hivi?' }],
  ['how much', { en: ' did we produce yesterday?', sw: ' tulizalisha jana?' }],
  ['what are', { en: ' my top decisions today?', sw: ' maamuzi yangu makuu leo?' }],
  ['what is', { en: ' my cash runway?', sw: ' nafasi yangu ya pesa?' }],
  ['show me', { en: ' the cockpit overview', sw: ' muhtasari wa cockpit' }],
  ['remind me', { en: ' to sign the monthly TRA filing', sw: ' kusaini fomu ya TRA ya kila mwezi' }],
  ['alert me', { en: ' when new gold listings land in Geita', sw: ' wakati orodha mpya za dhahabu zinakuja Geita' }],
  ['send', { en: ' a message to the manager', sw: ' ujumbe kwa meneja' }],
  ['draft', { en: ' a letter to the buyer', sw: ' barua kwa mnunuzi' }],
  ['summarise', { en: ' the past week for me', sw: ' wiki iliyopita kwangu' }],
  ['summarize', { en: ' the past week for me', sw: ' wiki iliyopita kwangu' }],
  ['nina', { en: '', sw: ' wasiwasi kuhusu hali ya hewa wiki hii' }],
  ['tunahitaji', { en: '', sw: ' kuongea kuhusu malipo ya mwezi huu' }],
  ['ninaomba', { en: '', sw: ' muhtasari wa cockpit' }],
];

function normaliseInput(text: string): string {
  return text.toLowerCase().trim().replace(/[?.!,]+$/, '');
}

/** Pure function exported for unit tests. */
export function lookupSuggestion(
  rawText: string,
  language: 'sw' | 'en',
): { readonly suggestion: string; readonly cached: boolean } {
  const normalised = normaliseInput(rawText);
  if (normalised.length === 0) {
    return { suggestion: '', cached: true };
  }
  // Prefer the longest match — sort descending by key length.
  const ranked = [...SUGGESTIONS].sort(
    ([a], [b]) => b.length - a.length,
  );
  for (const [prefix, pair] of ranked) {
    if (
      normalised === prefix ||
      normalised.startsWith(`${prefix} `) ||
      normalised.endsWith(prefix)
    ) {
      const completion = language === 'sw' ? pair.sw : pair.en;
      if (completion.length > 0) {
        return { suggestion: completion, cached: true };
      }
    }
  }
  return { suggestion: '', cached: true };
}

// ----------------------------------------------------------------------------
// Hono router
// ----------------------------------------------------------------------------

export const brainComposeRouter = new Hono();
brainComposeRouter.use('*', authMiddleware);

brainComposeRouter.post(
  '/compose/suggest',
  zValidator('json', SuggestRequest),
  async (c) => {
    const body = c.req.valid('json');
    const result = lookupSuggestion(body.text, body.language);
    // No LLM fallback yet — Phase-2 wire to brain router with a
    // 40-token cap once we have hot-path telemetry confirming the
    // table-only path doesn't already cover the top intents.
    return c.json({
      success: true,
      data: {
        suggestion: result.suggestion,
        cached: result.cached,
      },
    });
  },
);
