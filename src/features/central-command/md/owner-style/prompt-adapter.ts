/**
 * Prompt Adapter — rewrites a base prompt template so the system prompt
 * reflects the owner's style. Deterministic, snapshot-friendly: no LLM.
 *
 * Strategy: append a "style directive" paragraph that the downstream LLM
 * obeys. We DO NOT touch the user prompt content (substance is sacred);
 * we shape the system prompt's tone/verbosity/decision-style/risk
 * instructions.
 */

import type { OwnerStyleProfile } from "./style-dimensions";

export interface BasePrompt {
  readonly system: string;
  readonly user: string;
}

export interface AdaptedPrompt {
  readonly system: string;
  readonly user: string;
  readonly styleDirective: string;
}

// ---------------------------------------------------------------------------
// Per-dimension directive fragments
// ---------------------------------------------------------------------------

const TONE_DIRECTIVE: Record<OwnerStyleProfile["tone"]["value"], string> = {
  formal: "Adopt a formal, businesslike tone. No slang. No emoji.",
  casual:
    "Adopt a casual, friendly tone. Short sentences. Plain everyday words.",
  collegial:
    "Use a warm, collegial tone — speak as a peer on the same team, not a vendor.",
  coach_like:
    "Take a coach-like tone: ask one good question first, then propose action.",
};

const VERBOSITY_DIRECTIVE: Record<
  OwnerStyleProfile["verbosity"]["value"],
  string
> = {
  terse:
    "Be terse. One-liners by default. Maximum three sentences unless asked to expand.",
  balanced: "Balance brevity with substance. Aim for two short paragraphs.",
  verbose:
    "Expand on reasoning. Walk through the why, the trade-offs, and an example.",
};

const DECISION_DIRECTIVE: Record<
  OwnerStyleProfile["decisionStyle"]["value"],
  string
> = {
  directive:
    "Owner prefers directive style: state the recommended action first, then the one-line reason. Skip options unless asked.",
  collaborative:
    "Owner is collaborative: invite their judgement. Offer 2 options and ask which they'd pick before acting.",
  consultative:
    "Owner is consultative: present pros, cons, and a clear recommendation. Then ask whether to proceed.",
};

const RISK_DIRECTIVE: Record<
  OwnerStyleProfile["riskAppetite"]["value"],
  string
> = {
  conservative:
    "Frame recommendations conservatively. Surface downside scenarios first.",
  moderate: "Use a moderate risk frame — balanced upside/downside.",
  aggressive:
    "Owner has aggressive risk appetite. Lead with upside; flag downside only when material.",
};

const LANGUAGE_DIRECTIVE: Record<
  OwnerStyleProfile["languagePreference"]["value"],
  string
> = {
  english_only: "Reply only in English.",
  english_leaning_bilingual:
    "Reply in English; occasionally use a Swahili word if it fits naturally.",
  swahili_leaning_bilingual:
    "Anza kwa Kiswahili. Mix English where natural. Tafadhali use familiar SMB-Swahili.",
  swahili_only: "Jibu kwa Kiswahili pekee.",
};

const DOMAIN_DIRECTIVE: Record<
  OwnerStyleProfile["domainPriorities"]["value"],
  string
> = {
  sales_led:
    "Owner is sales-led: prioritise revenue, pipeline, and customer conversations.",
  ops_led:
    "Owner is ops-led: prioritise logistics, inventory, supply, and process insights.",
  people_led:
    "Owner is people-led: surface team, culture, and hiring implications first.",
  finance_led:
    "Owner is finance-led: lead with cashflow, margin, and unit economics.",
  balanced: "Owner has balanced priorities across sales, ops, finance, people.",
};

const CHANNEL_DIRECTIVE: Record<
  OwnerStyleProfile["channelPreference"]["value"],
  string
> = {
  chat_only:
    "Keep the response chat-shaped — no headers, no long bullet ladders.",
  chat_plus_email:
    "If the response is long, structure it like a short business email (greeting, two short paragraphs, sign-off).",
  chat_plus_voice:
    "Owner sometimes uses voice — keep phrasing speakable; avoid heavy formatting.",
  multi_channel:
    "Owner uses multiple channels — keep the message portable: no channel-specific formatting.",
};

// ---------------------------------------------------------------------------
// Confidence-gated directive composer
// ---------------------------------------------------------------------------

const CONFIDENCE_FLOOR = 0.35;

function include<T extends string>(
  dim: { value: T; confidence: number },
  table: Record<T, string>,
): string | null {
  if (dim.confidence < CONFIDENCE_FLOOR) return null;
  return table[dim.value];
}

/**
 * Build a deterministic style-directive paragraph from the profile.
 * Returns a stable, snapshot-friendly string — dimensions appear in a
 * fixed order so test snapshots don't churn.
 */
export function buildStyleDirective(profile: OwnerStyleProfile): string {
  const lines: string[] = [];
  const tone = include(profile.tone, TONE_DIRECTIVE);
  const verbosity = include(profile.verbosity, VERBOSITY_DIRECTIVE);
  const decision = include(profile.decisionStyle, DECISION_DIRECTIVE);
  const risk = include(profile.riskAppetite, RISK_DIRECTIVE);
  const language = include(profile.languagePreference, LANGUAGE_DIRECTIVE);
  const domain = include(profile.domainPriorities, DOMAIN_DIRECTIVE);
  const channel = include(profile.channelPreference, CHANNEL_DIRECTIVE);

  if (tone) lines.push(tone);
  if (verbosity) lines.push(verbosity);
  if (decision) lines.push(decision);
  if (risk) lines.push(risk);
  if (language) lines.push(language);
  if (domain) lines.push(domain);
  if (channel) lines.push(channel);

  if (lines.length === 0) {
    return "Use a neutral, professional voice. Profile not yet confident enough to specialize.";
  }
  return ["OWNER-STYLE DIRECTIVE:", ...lines.map((l) => `- ${l}`)].join("\n");
}

/**
 * Adapt a base prompt by appending the style directive to the system prompt.
 * The user prompt is returned unchanged.
 */
export function adaptPrompt(
  base: BasePrompt,
  profile: OwnerStyleProfile,
): AdaptedPrompt {
  const directive = buildStyleDirective(profile);
  const system = `${base.system.trimEnd()}\n\n${directive}`;
  return { system, user: base.user, styleDirective: directive };
}
