/**
 * Style Hint — projects a learned OwnerStyleProfile into a concise,
 * deterministic directive paragraph that future turns fold into the persona
 * system prompt.
 *
 * Strategy (minimal + additive):
 *   - Only dimensions confident enough (>= CONFIDENCE_FLOOR) emit a line.
 *   - Substance is sacred — we shape the persona's tone / verbosity / detail /
 *     decision-risk posture, never the user's content.
 *   - Language: we surface the learned LEAN as a soft hint only. The ABSOLUTE
 *     EN/SW toggle is owned by user settings and must win at render time; this
 *     hint never overrides it (CLAUDE.md: toggle is absolute, no mixing).
 *
 * Returns an empty string when the profile is not yet confident — callers then
 * leave the base system prompt untouched (honest-degrade, no fabrication).
 */

import type { OwnerStyleProfile } from './style-dimensions.js';

const CONFIDENCE_FLOOR = 0.5;

const VERBOSITY_DIRECTIVE: Record<
  OwnerStyleProfile['verbosity']['value'],
  string
> = {
  terse: 'Be terse: one-liners by default; at most three sentences unless asked to expand.',
  balanced: 'Balance brevity with substance: aim for a short paragraph or two.',
  verbose: 'Expand on reasoning: walk through the why and the trade-offs.',
};

const DETAIL_DIRECTIVE: Record<OwnerStyleProfile['detail']['value'], string> = {
  low: 'Lead with the bottom line; keep supporting detail minimal.',
  medium: 'Give the answer plus a sentence of supporting reasoning.',
  high: 'Surface the reasoning, the numbers, and any caveats behind the answer.',
};

const FORMALITY_DIRECTIVE: Record<
  OwnerStyleProfile['formality']['value'],
  string
> = {
  formal: 'Adopt a formal, businesslike register. No slang.',
  neutral: 'Use a professional, plain register.',
  casual: 'Use a warm, casual register; speak as a trusted peer.',
};

const POSTURE_DIRECTIVE: Record<
  OwnerStyleProfile['posture']['value'],
  string
> = {
  cautious:
    'Owner is cautious: surface downside and options first; recommend the safer path.',
  balanced: 'Owner has a balanced risk posture: weigh upside against downside.',
  bold: 'Owner is decisive and bold: state the recommended action first; flag downside only when material.',
};

/**
 * Soft language hints. NEVER an absolute override — the user-settings toggle
 * is authoritative. `en`/`sw` leans intentionally emit no line so we never
 * fight the absolute toggle; only the bilingual leans nudge.
 */
const LANGUAGE_DIRECTIVE: Record<
  OwnerStyleProfile['language']['value'],
  string | null
> = {
  en: null,
  sw: null,
  en_leaning_bilingual:
    'Owner leans English but is comfortable with the occasional Swahili term where natural (only if the active locale permits Swahili).',
  sw_leaning_bilingual:
    'Owner leans Swahili in bilingual contexts (honour the active locale toggle — never mix locales in a single reply).',
};

function include<T extends string>(
  dim: { value: T; confidence: number },
  table: Record<T, string | null>
): string | null {
  if (dim.confidence < CONFIDENCE_FLOOR) return null;
  return table[dim.value];
}

/**
 * Build a deterministic, snapshot-friendly style hint. Dimensions appear in a
 * fixed order. Returns '' when nothing is confident enough.
 */
export function buildStyleHint(profile: OwnerStyleProfile): string {
  const lines: string[] = [];
  const verbosity = include(profile.verbosity, VERBOSITY_DIRECTIVE);
  const detail = include(profile.detail, DETAIL_DIRECTIVE);
  const formality = include(profile.formality, FORMALITY_DIRECTIVE);
  const posture = include(profile.posture, POSTURE_DIRECTIVE);
  const language = include(profile.language, LANGUAGE_DIRECTIVE);

  if (verbosity) lines.push(verbosity);
  if (detail) lines.push(detail);
  if (formality) lines.push(formality);
  if (posture) lines.push(posture);
  if (language) lines.push(language);

  if (lines.length === 0) return '';
  return ['LEARNED OWNER-STYLE (adapt how, not what):', ...lines.map((l) => `- ${l}`)].join(
    '\n'
  );
}

/**
 * Fold the learned style hint into a base system prompt. Returns the base
 * prompt unchanged when the profile is not yet confident (no fabrication).
 */
export function applyStyleHint(
  baseSystemPrompt: string,
  profile: OwnerStyleProfile
): string {
  const hint = buildStyleHint(profile);
  if (!hint) return baseSystemPrompt;
  return `${baseSystemPrompt.trimEnd()}\n\n${hint}`;
}
