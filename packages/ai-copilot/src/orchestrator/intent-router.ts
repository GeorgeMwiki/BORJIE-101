/**
 * Intent Router
 *
 * Classifies a user turn into an intent and decides which persona should own
 * the turn. THIS IS CODE, NOT AN LLM. The LLM suggests intent inside a
 * persona's response (via the HANDOFF_TO directive), but the router is the
 * deterministic authority that enforces routing, RBAC, and visibility.
 *
 * Two modes:
 *  1. `classifyInitialTurn` — called at the top of a conversation to decide
 *     the primary persona. Uses keyword/pattern heuristics; for ambiguous
 *     cases, defaults to the Estate Manager, which can delegate.
 *  2. `parseHandoffDirective` — scans a persona response for
 *     `HANDOFF_TO:` + `OBJECTIVE:` lines and returns a structured directive.
 */

import { PERSONA_IDS } from '../personas/persona.js';

export interface Intent {
  personaId: string;
  confidence: number;
  /** Short rationale shown in the trace. */
  rationale: string;
}

/**
 * Keyword bundles per persona. Kept deliberately simple and auditable.
 * This is a router, not a classifier — it's deterministic by design.
 * Hard NLU goes to the persona's LLM; this is only the first hop.
 */
const KEYWORDS: Array<{ personaId: string; patterns: RegExp[] }> = [
  {
    personaId: PERSONA_IDS.JUNIOR_MAINTENANCE,
    patterns: [
      /\b(leak|broken|repair|fix|plumb|electric|hvac|water|gas|pest|caretaker|vendor|work[- ]?order|wo\b|maintenance|emergency)\b/i,
    ],
  },
  {
    personaId: PERSONA_IDS.JUNIOR_FINANCE,
    patterns: [
      /\b(rent|arrears?|pay(ment)?|mpesa|m-pesa|ledger|owner statement|reconcil|deposit|service charge|levy|levies|kra|vat|withholding|invoice|receipt)\b/i,
    ],
  },
  {
    personaId: PERSONA_IDS.JUNIOR_LEASING,
    patterns: [
      /\b(lease|renew(al)?|applicant|viewing|move[- ]in|move[- ]out|vacancy|listing|applicant)\b/i,
    ],
  },
  {
    personaId: PERSONA_IDS.JUNIOR_COMPLIANCE,
    patterns: [
      /\b(comply|compliance|dpa|gdpr|kra filing|dispute|case|court|eviction|notice to quit|legal|subpoena|evidence pack)\b/i,
    ],
  },
  {
    personaId: PERSONA_IDS.JUNIOR_COMMUNICATIONS,
    patterns: [
      /\b(announce|announcement|broadcast|whatsapp|sms|email blast|campaign|newsletter|circular|tenants? notice|message tenants?)\b/i,
    ],
  },
  {
    personaId: PERSONA_IDS.MIGRATION_WIZARD,
    patterns: [
      /\b(migrat|onboard|upload (roster|data|file)|import|excel|csv|spreadsheet from|legacy system|move from)\b/i,
    ],
  },
];

/**
 * Classify the initial turn. Ambiguous or portfolio-level phrasing routes
 * to the Estate Manager, which can delegate.
 */
export function classifyInitialTurn(userText: string): Intent {
  const hits: Array<{ personaId: string; score: number }> = [];
  for (const { personaId, patterns } of KEYWORDS) {
    const score = patterns.reduce(
      (s, p) => s + (p.test(userText) ? 1 : 0),
      0
    );
    if (score > 0) hits.push({ personaId, score });
  }
  hits.sort((a, b) => b.score - a.score);

  // If we have a clear winner, route directly. Otherwise, Estate Manager.
  if (hits.length === 1 || (hits.length >= 2 && hits[0].score > hits[1].score)) {
    return {
      personaId: hits[0].personaId,
      confidence: Math.min(0.9, 0.5 + 0.1 * hits[0].score),
      rationale: `keyword_match:${hits[0].personaId}(score=${hits[0].score})`,
    };
  }

  return {
    personaId: PERSONA_IDS.ESTATE_MANAGER,
    confidence: 0.6,
    rationale:
      hits.length === 0
        ? 'no_keyword_match:default_to_estate_manager'
        : 'ambiguous_keywords:default_to_estate_manager',
  };
}

export interface HandoffDirective {
  targetPersonaId: string;
  objective: string;
}

/**
 * Parse `HANDOFF_TO: <id>` + `OBJECTIVE: <sentence>` directives from a
 * persona response. Returns null if no directive present.
 *
 * Tolerant to formatting drift: the directive may appear anywhere in the
 * response (not strictly on its own line) so a model that wraps the
 * delimiter in punctuation or backticks still routes correctly. The
 * objective grabs everything to end-of-line.
 */
export function parseHandoffDirective(
  text: string
): HandoffDirective | null {
  const handoffMatch = text.match(/HANDOFF_TO:\s*([a-zA-Z0-9._-]+)/);
  const objectiveMatch = text.match(/OBJECTIVE:\s*([^\n\r]+)/);
  if (!handoffMatch) return null;
  const targetPersonaId = handoffMatch[1];
  const objective = objectiveMatch
    ? objectiveMatch[1].trim()
    : '(no explicit objective)';
  return { targetPersonaId, objective };
}

export interface ProposedAction {
  verb: string;
  object: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

/**
 * Parse `PROPOSED_ACTION: <verb> <object> [risk:<level>]` from a persona
 * response. Returns null if none. Tolerant to drift: directive may appear
 * anywhere in the response; risk bracket is optional and case-insensitive.
 */
export function parseProposedAction(text: string): ProposedAction | null {
  // Bounded non-greedy body ([^\n\r]{1,500}?) prevents catastrophic
  // backtracking while still covering any realistic action line.
  const m = text.match(
    /PROPOSED_ACTION:\s*(\S+)\s+([^\n\r]{1,500}?)(?:\s*\[risk:(LOW|MEDIUM|HIGH|CRITICAL)\])?\s*(?:\r?\n|$)/i
  );
  if (!m) return null;
  return {
    verb: m[1],
    object: m[2].trim(),
    riskLevel: (m[3]?.toUpperCase() as ProposedAction['riskLevel']) ?? 'MEDIUM',
  };
}
