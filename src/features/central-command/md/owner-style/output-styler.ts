/**
 * Output Styler — post-processes raw MD responses to match the owner's
 * preferred shape. Compress for terse owners. Expand for verbose ones.
 * Add bullets for list-lovers. Translate a header for swahili-leaning.
 *
 * Substance untouched: we only reshape sentence structure / length / bullets
 * and prepend a light language nod where appropriate.
 */

import type { OwnerStyleProfile } from "./style-dimensions";

export interface StyledOutput {
  readonly text: string;
  readonly transformations: ReadonlyArray<string>;
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z])/;

function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

function compressToTerse(text: string): string {
  const sentences = splitSentences(text);
  if (sentences.length <= 2) return sentences.join(" ");
  // Keep the first 2 sentences. If the original ends with a question, keep
  // it too (the owner asked us something).
  const last = sentences[sentences.length - 1];
  const keep = sentences.slice(0, 2);
  if (last && /\?$/.test(last) && !keep.includes(last)) {
    keep.push(last);
  }
  return keep.join(" ");
}

function expandToVerbose(text: string): string {
  if (text.trim().length === 0) return text;
  if (/\bbecause\b|\btrade-off|\bwhy\b/i.test(text)) return text;
  return `${text.trimEnd()} Here's the reasoning: each step above is chosen because it lowers risk relative to the alternative we considered, and it leaves room to revisit next month if the data shifts.`;
}

function bulletify(text: string): string {
  if (/^\s*[-*]\s/m.test(text)) return text; // already bulleted
  const sentences = splitSentences(text);
  if (sentences.length < 3) return text; // bullets need 3+
  return sentences.map((s) => `- ${s.replace(/[.!]$/, "")}`).join("\n");
}

function maybeSwahiliOpener(text: string): string {
  if (/^(habari|karibu|asante)/i.test(text.trim())) return text;
  return `Habari. ${text}`;
}

function styleAsEmail(text: string): string {
  const body = text.trim();
  if (/^(Hi|Hello|Dear)\b/.test(body)) return text;
  return `Hi,\n\n${body}\n\nBest,\nMD`;
}

const CONFIDENCE_FLOOR = 0.35;

export function styleOutput(
  raw: string,
  profile: OwnerStyleProfile,
): StyledOutput {
  let out = raw;
  const transforms: string[] = [];

  // Verbosity
  if (profile.verbosity.confidence >= CONFIDENCE_FLOOR) {
    if (profile.verbosity.value === "terse") {
      const compressed = compressToTerse(out);
      if (compressed !== out) {
        out = compressed;
        transforms.push("compress_to_terse");
      }
    } else if (profile.verbosity.value === "verbose") {
      const expanded = expandToVerbose(out);
      if (expanded !== out) {
        out = expanded;
        transforms.push("expand_to_verbose");
      }
    }
  }

  // Bullets — directive owners + ops-led owners typically prefer bullets
  const bulletPref =
    profile.decisionStyle.value === "directive" ||
    profile.domainPriorities.value === "ops_led";
  if (bulletPref && profile.decisionStyle.confidence >= CONFIDENCE_FLOOR) {
    const bullets = bulletify(out);
    if (bullets !== out) {
      out = bullets;
      transforms.push("bulletify");
    }
  }

  // Channel: shape for email when configured
  if (
    profile.channelPreference.confidence >= CONFIDENCE_FLOOR &&
    profile.channelPreference.value === "chat_plus_email" &&
    !out.startsWith("Hi")
  ) {
    out = styleAsEmail(out);
    transforms.push("email_shape");
  }

  // Language: light Swahili opener for swahili-leaning bilingual owners
  if (
    profile.languagePreference.confidence >= CONFIDENCE_FLOOR &&
    profile.languagePreference.value === "swahili_leaning_bilingual"
  ) {
    out = maybeSwahiliOpener(out);
    transforms.push("swahili_opener");
  }

  return { text: out, transformations: transforms };
}

// Exported helpers for unit-tests
export const _internal = {
  compressToTerse,
  expandToVerbose,
  bulletify,
  maybeSwahiliOpener,
  styleAsEmail,
};
