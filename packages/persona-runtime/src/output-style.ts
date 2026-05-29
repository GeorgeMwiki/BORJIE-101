/**
 * Output style — Claude Code parity (CC-6).
 *
 * Owner-preference toggle for the brain's response register. Mirrors
 * Claude Code's `outputStyle` setting (terse / detailed / bullet /
 * explanatory) plus a Borjie-specific `narrative` mode for owner
 * briefings.
 *
 * Design notes:
 *
 *   - Pure module — no I/O, no clock dependence. The brain's persona
 *     composer reads the resolved style and emits an ADDITIONAL system-
 *     prompt fragment AFTER the frozen wit-anchor (so the cache prefix
 *     stays identical across turns even when the style changes).
 *
 *   - 5 modes:
 *       'terse'        — 1–3 short lines, no preamble, no follow-ups.
 *       'detailed'     — full rationale + caveats + alternatives.
 *       'bullet'       — primarily bullet/list structure.
 *       'narrative'    — owner-briefing prose (CEO mode default).
 *       'explanatory'  — teaches the user the underlying reasoning.
 *
 *   - Persistence: owners persist the chosen mode in
 *     `tenants.preferences.output_style`; ephemeral overrides (e.g.
 *     "/style terse" mid-chat) live in the session store. The
 *     `resolveOutputStyle()` resolver returns the effective value with
 *     ephemeral > tenant > default precedence.
 *
 *   - Bilingual: every fragment ships sw + en variants because every
 *     persona greets sw-first (CLAUDE.md hard rule).
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Enum + schema
// ─────────────────────────────────────────────────────────────────────

export const OUTPUT_STYLES = [
  'terse',
  'detailed',
  'bullet',
  'narrative',
  'explanatory',
] as const;

export type OutputStyle = (typeof OUTPUT_STYLES)[number];

export const OutputStyleSchema = z.enum(OUTPUT_STYLES);

export const DEFAULT_OUTPUT_STYLE: OutputStyle = 'detailed';

// ─────────────────────────────────────────────────────────────────────
// Resolver — ephemeral > tenant > default precedence.
// ─────────────────────────────────────────────────────────────────────

export interface OutputStyleResolverInput {
  /** Per-session override set by `/style …` mid-chat. */
  readonly ephemeralOverride?: OutputStyle;
  /** Persisted tenant preference (`tenants.preferences.output_style`). */
  readonly tenantPreference?: OutputStyle;
}

export function resolveOutputStyle(
  input: OutputStyleResolverInput,
): OutputStyle {
  if (input.ephemeralOverride !== undefined) {
    return input.ephemeralOverride;
  }
  if (input.tenantPreference !== undefined) {
    return input.tenantPreference;
  }
  return DEFAULT_OUTPUT_STYLE;
}

// ─────────────────────────────────────────────────────────────────────
// System-prompt fragments — bilingual sw/en.
// Each fragment is appended AFTER the frozen wit-anchor block so the
// Anthropic prefix-cache hash stays stable when only the style changes
// (the wit anchor is the cache-eligible prefix per
// `packages/ai-copilot/src/providers/anthropic-prefix-cache.ts`).
// ─────────────────────────────────────────────────────────────────────

interface StyleFragment {
  readonly en: string;
  readonly sw: string;
}

const FRAGMENTS: Readonly<Record<OutputStyle, StyleFragment>> = Object.freeze({
  terse: Object.freeze({
    en: [
      '[OUTPUT STYLE: TERSE]',
      '- Reply in 1-3 lines. No preamble. No closing pleasantries.',
      '- Lead with the answer. Skip caveats unless safety-critical.',
      '- Use prompt-suggestions for follow-ups; do NOT enumerate options inline.',
    ].join('\n'),
    sw: [
      '[MTINDO WA JIBU: FUPI]',
      '- Jibu kwa mistari 1-3 tu. Bila utangulizi. Bila salamu za kumalizia.',
      '- Anza na jibu. Ruka tahadhari isipokuwa muhimu kwa usalama.',
      '- Tumia mapendekezo-haraka kwa maswali ya kufuatia.',
    ].join('\n'),
  }),
  detailed: Object.freeze({
    en: [
      '[OUTPUT STYLE: DETAILED]',
      '- Provide full rationale, evidence chain, and at least one alternative.',
      '- Surface relevant caveats, edge cases, and risk-tier escalation triggers.',
      '- Cite every evidence_id you rely on.',
    ].join('\n'),
    sw: [
      '[MTINDO WA JIBU: KAMILI]',
      '- Toa sababu kamili, mlolongo wa ushahidi, na njia mbadala moja.',
      '- Onyesha tahadhari, mipaka, na vichocheo vya kupanda hatari.',
      '- Taja kila evidence_id unayotumia.',
    ].join('\n'),
  }),
  bullet: Object.freeze({
    en: [
      '[OUTPUT STYLE: BULLET]',
      '- Structure the entire response as bullets or a numbered list.',
      '- Sub-bullets for evidence; one fact per line.',
      '- One terminal sentence ("Next step:") may close the response.',
    ].join('\n'),
    sw: [
      '[MTINDO WA JIBU: ORODHA]',
      '- Panga jibu zima kama orodha ya nukta au nambari.',
      '- Nukta-ndogo kwa ushahidi; jambo moja kwa kila mstari.',
      '- Sentensi moja ya mwisho ("Hatua inayofuata:") inaweza kufunga jibu.',
    ].join('\n'),
  }),
  narrative: Object.freeze({
    en: [
      '[OUTPUT STYLE: NARRATIVE]',
      '- Owner-briefing prose. 2-4 paragraphs, no headings.',
      '- First paragraph: the verdict. Subsequent paragraphs: the story.',
      '- End with a prompt-suggestions block, not a Q&A list.',
    ].join('\n'),
    sw: [
      '[MTINDO WA JIBU: SIMULIZI]',
      '- Maandishi ya mkutano wa mmiliki. Aya 2-4, bila vichwa.',
      '- Aya ya kwanza: hukumu. Aya zinazofuata: hadithi.',
      '- Malizia na mapendekezo-haraka, sio orodha ya maswali.',
    ].join('\n'),
  }),
  explanatory: Object.freeze({
    en: [
      '[OUTPUT STYLE: EXPLANATORY]',
      '- Teach the underlying mechanic before answering.',
      '- Show worked examples where appropriate.',
      '- End with "If you want to dive deeper:" + 2-3 follow-up prompts.',
    ].join('\n'),
    sw: [
      '[MTINDO WA JIBU: MAFUNZO]',
      '- Eleza utaratibu wa msingi kabla ya jibu.',
      '- Onyesha mifano halisi pale inapowezekana.',
      '- Malizia na "Ukitaka kuingia kwa kina:" + maswali 2-3 ya kufuatia.',
    ].join('\n'),
  }),
});

// ─────────────────────────────────────────────────────────────────────
// Render — emit the system-prompt fragment for the resolved style.
// The persona composer appends this DOWNSTREAM of the frozen wit-anchor
// so prompt-cache hash stability is preserved.
// ─────────────────────────────────────────────────────────────────────

export interface RenderOutputStyleInput {
  readonly style: OutputStyle;
  readonly locale: 'en' | 'sw';
}

export function renderOutputStyleFragment(
  input: RenderOutputStyleInput,
): string {
  const fragment = FRAGMENTS[input.style];
  return input.locale === 'sw' ? fragment.sw : fragment.en;
}

// ─────────────────────────────────────────────────────────────────────
// Slash-command parser — owners type "/style terse" mid-chat to flip.
// Returns the parsed style or `null` for "show current" / invalid.
// ─────────────────────────────────────────────────────────────────────

export interface ParseStyleSlashResult {
  readonly action: 'set' | 'show' | 'invalid';
  readonly style?: OutputStyle;
  readonly raw?: string;
}

export function parseStyleSlashCommand(args: string): ParseStyleSlashResult {
  const trimmed = args.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'show') {
    return { action: 'show' };
  }
  if ((OUTPUT_STYLES as ReadonlyArray<string>).includes(trimmed)) {
    return { action: 'set', style: trimmed as OutputStyle };
  }
  return { action: 'invalid', raw: trimmed };
}
