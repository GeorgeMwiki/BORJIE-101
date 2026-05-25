/**
 * Defection probe — kernel-boundary behavioural classifier.
 *
 * A "defection" is when the agent's output diverges from the persona's
 * expected behaviour distribution. Examples:
 *
 *   - Owner-portal persona suddenly speaks in tenant first-person
 *     ("I'd like to pay my rent").
 *   - Estate-manager persona offers legal opinions outside its scope.
 *   - Marketing-guide persona name-drops a real tenant's address.
 *
 * This module is a deterministic heuristic + an optional model-backed
 * deep probe. The heuristic returns a signal in O(token-count) without
 * any LLM call so the kernel can run it on every turn. The model probe
 * is opt-in for high-stakes turns.
 *
 * Outputs are advisory — the kernel mixes them into the system-prompt
 * "self-awareness" block but does not refuse on a defection signal
 * alone. A separate critic (persona-drift) handles enforcement.
 */

import type { PersonaIdentity } from '../identity.js';

export type DefectionSeverity = 'none' | 'mild' | 'severe';

export interface DefectionSignal {
  readonly severity: DefectionSeverity;
  readonly reasons: ReadonlyArray<string>;
  /** Confidence score for the signal, ∈ [0, 1]. */
  readonly confidence: number;
}

export interface DefectionProbeInput {
  readonly persona: PersonaIdentity;
  readonly outputText: string;
  /**
   * Optional reference of the persona's recent output history — when
   * supplied, the probe checks for sudden voice / register shifts.
   * Each entry is a previous turn's normalised text.
   */
  readonly history?: ReadonlyArray<string>;
}

export interface DefectionProbe {
  classify(input: DefectionProbeInput): DefectionSignal;
}

/**
 * Words / phrases that, when present, indicate the agent has slipped
 * out of its first-person voice. The map is per-persona because
 * "I" is the owner persona's first-person while the resident persona
 * is also "I" — the slippage we care about is BETWEEN personas.
 */
const PERSONA_FORBIDDEN_FIRST_PERSON: Record<string, ReadonlyArray<string>> = {
  // Owner uses "we" — slipping to a tenant-style "I'd like" is a defection.
  'owner-advisor': [
    /\bi'?d like to pay\b/i.source,
    /\bmy rent\b/i.source,
    /\bmy lease\b/i.source,
    /\bmy maintenance request\b/i.source,
  ],
  // Tenant-resident uses "I" — slipping to a portfolio "we collected" is a defection.
  'tenant-resident': [
    /\bwe collected\b/i.source,
    /\bour portfolio\b/i.source,
    /\bour tenants\b/i.source,
  ],
  // Estate-manager — slipping to first-person plural marketing language.
  'estate-manager': [
    /\bjoin our community\b/i.source,
    /\bsign up today\b/i.source,
  ],
};

const GENERIC_DEFECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bas an ai (language )?model\b/i,
  /\bi don'?t have (the )?(ability|access)\b/i,
  /\bi am chatgpt\b/i,
  /\bi'?m claude\b/i,
  /\bi cannot help with that\b/i,
];

export function createDefectionProbe(): DefectionProbe {
  return {
    classify(input) {
      const reasons: string[] = [];
      const text = input.outputText ?? '';
      const personaId = input.persona.id;

      if (!text || text.trim().length === 0) {
        return { severity: 'none', reasons: [], confidence: 0 };
      }

      // 1) Generic model-self-identification leaks — always severe.
      for (const re of GENERIC_DEFECTION_PATTERNS) {
        if (re.test(text)) {
          reasons.push(`model-self-identification:${re.source}`);
        }
      }

      // 2) Persona-specific forbidden phrases.
      const forbidden = PERSONA_FORBIDDEN_FIRST_PERSON[personaId] ?? [];
      for (const patternSrc of forbidden) {
        const re = new RegExp(patternSrc);
        if (re.test(text)) {
          reasons.push(`persona-voice-slip:${patternSrc}`);
        }
      }

      // 3) Taboo-signal match — pulled directly from the persona's
      //    `violationSignals` array. Substring match (case-insensitive)
      //    matches the self-awareness check shape.
      const lower = text.toLowerCase();
      for (const sig of input.persona.violationSignals) {
        if (lower.includes(sig.toLowerCase())) {
          reasons.push(`taboo-signal:${sig}`);
        }
      }

      // 4) Voice shift vs. recent history — when the prior history is
      //    available we look for a sudden change in first-person form.
      //    Uses a word-boundary regex so a sentence-initial pronoun
      //    ("I have updated your record.") matches just like a mid-
      //    sentence one. The previous space-padded substring check
      //    missed sentence-initial pronouns entirely.
      if (Array.isArray(input.history) && input.history.length >= 2) {
        const noun = input.persona.firstPersonNoun.toLowerCase();
        const wordRe = new RegExp(
          `\\b${noun.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`,
          'i',
        );
        const recentCount = input.history
          .slice(-3)
          .filter((h) => wordRe.test(h))
          .length;
        const currentUses = wordRe.test(text);
        if (recentCount >= 2 && !currentUses && text.length > 80) {
          reasons.push('sudden-voice-drop');
        }
      }

      // 5) Severity derivation.
      let severity: DefectionSeverity = 'none';
      const hasGenericLeak = reasons.some((r) =>
        r.startsWith('model-self-identification'),
      );
      const hasTabooSlip = reasons.some((r) => r.startsWith('taboo-signal'));
      const hasPersonaSlip = reasons.some((r) =>
        r.startsWith('persona-voice-slip'),
      );

      if (hasGenericLeak || hasTabooSlip) severity = 'severe';
      else if (hasPersonaSlip || reasons.length > 0) severity = 'mild';

      const confidence =
        severity === 'severe' ? 0.95 : severity === 'mild' ? 0.55 : 0;

      return { severity, reasons, confidence };
    },
  };
}
