/**
 * Response styler — pure text transformation.
 *
 * Given a `VoiceProfile` and a `ResponseDraft`, returns a fully
 * styled `ResponseStyle`. No I/O, no LLM call. The styler captures
 * the *envelope* of each voice (preamble, structural metadata,
 * artifact placement) and lets the host's LLM produce the body.
 *
 * This separation matters: deterministic styling is testable in
 * isolation, while the LLM portion of Mr. Mwikila's response is
 * tested elsewhere with red-team / sycophancy / calibration suites.
 */

import type {
  ResponseDraft,
  ResponseStyle,
  ResponseStructure,
  VoiceMode,
  VoiceProfile,
} from '../types.js';

/** GUIDE-mode preamble — first-person plural, action verbs. */
export const GUIDE_PREAMBLE = "Here's what I've drafted for you:";
/** LEARN-mode preamble — Socratic, scaffolded. */
export const LEARN_PREAMBLE = "Before we draft, let's walk through this together.";
/** BALANCED-mode preamble — neutral. */
export const BALANCED_PREAMBLE = 'Quick summary, with reasoning available:';

/** Tail line nudging the user toward the action in GUIDE. */
export const GUIDE_TAIL = 'Approve when ready.';
/** Tail line nudging the user toward the next reasoning step in LEARN. */
export const LEARN_TAIL = 'Walk me through your answer — I will check.';
/** BALANCED has a softer tail. */
export const BALANCED_TAIL = "Tap 'why' to expand the math; tap 'approve' to ship.";

function preamble(mode: VoiceMode): string {
  if (mode === 'guide') return GUIDE_PREAMBLE;
  if (mode === 'learn') return LEARN_PREAMBLE;
  return BALANCED_PREAMBLE;
}

function tail(mode: VoiceMode): string {
  if (mode === 'guide') return GUIDE_TAIL;
  if (mode === 'learn') return LEARN_TAIL;
  return BALANCED_TAIL;
}

function structureFor(mode: VoiceMode): ResponseStructure {
  if (mode === 'guide') {
    return {
      artifact_first: true,
      explanation_first: false,
      include_clarifiers: false,
      collapsible_reasoning: true,
    };
  }
  if (mode === 'learn') {
    return {
      artifact_first: false,
      explanation_first: true,
      include_clarifiers: true,
      collapsible_reasoning: false,
    };
  }
  return {
    artifact_first: true,
    explanation_first: false,
    include_clarifiers: false,
    collapsible_reasoning: true,
  };
}

function clarifierBlock(
  clarifiers: ReadonlyArray<string> | undefined,
): string {
  if (!clarifiers || clarifiers.length === 0) return '';
  const numbered = clarifiers
    .map((q, i) => `${(i + 1).toString()}. ${q}`)
    .join('\n');
  return `\n\nLet's start with these:\n${numbered}`;
}

function verbositySuffix(level: number): string {
  if (level <= 1) return '';
  if (level === 2) return '';
  if (level === 3) return '\n\nI can go deeper on any step — just ask.';
  if (level === 4) {
    return '\n\nI can go deeper on any step — just ask. I will also flag any assumptions I made.';
  }
  return '\n\nI can go deeper on any step — just ask. I will also flag any assumptions I made, plus alternatives I considered.';
}

/**
 * Style a draft per the user's voice profile. The function is pure
 * and synchronous — the caller decides whether to render the styled
 * text to chat-ui, email body, or WhatsApp message.
 */
export function styleResponse(
  profile: VoiceProfile,
  draft: ResponseDraft,
): ResponseStyle {
  const lines: string[] = [];
  lines.push(preamble(profile.mode));
  lines.push('');
  lines.push(draft.body);

  if (profile.mode === 'learn') {
    lines.push(clarifierBlock(draft.clarifier_questions));
  }

  lines.push('');
  lines.push(tail(profile.mode));

  const styledText = `${lines.join('\n')}${verbositySuffix(
    profile.verbosity_level,
  )}`.trim();

  const result: ResponseStyle = {
    mode: profile.mode,
    verbosity_level: profile.verbosity_level,
    text: styledText,
    structure: structureFor(profile.mode),
    ...(draft.action ? { action: draft.action } : {}),
    ...(draft.citations ? { citations: draft.citations } : {}),
  };
  return result;
}
