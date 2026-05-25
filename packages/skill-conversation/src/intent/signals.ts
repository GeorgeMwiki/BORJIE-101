/**
 * Surface-level NL signals that bias the intent classifier toward one of the
 * four intent kinds. Signals are token/regex matches against the lowercased
 * input. They never overrule each other on their own — the classifier
 * aggregates them in `classifier.ts` and produces a confidence score.
 *
 * The signal vocabulary is intentionally bilingual (English + Swahili) since
 * Borjie owners write in both. Adding a new language is a one-line patch
 * (extend the keyword arrays).
 */

export type SignalKind =
  | 'recurring-cadence'
  | 'conditional-trigger'
  | 'imperative-now'
  | 'question-marker'
  | 'destructive-verb'
  | 'recipient-self-reference';

export interface Signal {
  readonly kind: SignalKind;
  readonly matched: string;
}

interface PatternGroup {
  readonly kind: SignalKind;
  readonly patterns: ReadonlyArray<RegExp>;
}

/**
 * Recurring cadence — every X / each Y / on the Nth / weekly / quarterly.
 */
const RECURRING_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\bevery\s+(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|hour|year|quarter|fortnight)\b/,
  /\beach\s+(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|year|quarter)\b/,
  /\bon\s+the\s+\d{1,2}(st|nd|rd|th)?(\s+(day\s+)?(of\s+)?(each|every|the)\s+month)?\b/,
  /\b(weekly|daily|hourly|monthly|quarterly|annually|yearly|fortnightly|biweekly)\b/,
  /\bonce\s+a\s+(day|week|month|year|quarter|month)\b/,
  /\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b.*\b(every|each|on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/,
  // Swahili
  /\bkila\s+(siku|wiki|mwezi|asubuhi|jioni|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi|jumapili)\b/,
  /\bmara\s+moja\s+(kwa|kila)\s+(siku|wiki|mwezi|mwaka)\b/,
]);

/**
 * Conditional triggers — if/when/whenever/should/unless.
 */
const CONDITIONAL_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\bif\s+(my|the|a|an|any|all)\s+\w+/,
  /\bwhen(ever)?\s+(my|the|a|an|any|all|cash|arrears|lease|tenant|payment)/,
  /\bonce\s+(my|the|a|an|any|all|cash|arrears|lease|tenant|payment)/,
  /\bshould\s+(my|the|a|an|cash|arrears|payment)\s+\w+/,
  /\bunless\s+\w+/,
  /\bin\s+case\s+\w+/,
  /\bevery\s+time\s+\w+/,
  /\b(lease|leases)\s+(ends?|ending|expires?|expiring)\s+in\s+\d+\s+days?\b/,
  /\b\d+\s+days?\s+(before|after)\s+(any\s+|the\s+|a\s+|an\s+)?(lease|tenant|invoice|payment|contract|renewal|anniversary)\b/,
  // Swahili
  /\bikiwa\s+\w+/,
  /\bendapo\s+\w+/,
  /\bwakati\s+\w+/,
]);

/**
 * Imperative now — send / do / draft / show / give me / what.
 *
 * We split this into two: ad-hoc actions vs questions. Ad-hoc actions are
 * imperatives that mutate state; questions are interrogatives.
 */
const IMPERATIVE_NOW_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\b(send|draft|create|generate|prepare|file|submit|email|sms|call)\b.*\b(now|right\s+now|today|asap)\b/,
  /^(please\s+)?(send|draft|create|generate|prepare|file|submit|email|sms|call|delete|remove|archive|publish|post)\s+\w+/,
  /\b(give|hand|show|tell)\s+me\s+\w+/,
]);

/**
 * Questions — what/who/when/why/how/where/show me/list/get/how many/how much.
 */
const QUESTION_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /^\s*(what|who|when|why|how|where|which)\b/,
  /\?\s*$/,
  /\b(show\s+me|list|what\s+is|what\s+are|how\s+many|how\s+much|tell\s+me)\b/,
  /\b(can\s+you|could\s+you)\s+tell\s+me\b/,
  // Swahili
  /\b(nini|nani|lini|kwa\s+nini|jinsi|wapi)\b/,
]);

/**
 * Destructive verbs that need a sandbox-divert or 4-eye guard. The intent
 * classifier doesn't reject these — it just notes them. The downstream AOP
 * permission-validator does the rejection if no guard precedes the tool.
 */
const DESTRUCTIVE_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\b(evict|eviction|terminate\s+lease|cancel\s+contract|delete\s+account|wipe|purge|charge\s+back)\b/,
  /\b(refund|chargeback|reverse\s+payment|deduct)\b/,
]);

/**
 * Self-reference — "send ME a brief", "alert ME", "remind ME". This is a
 * strong recurring-skill signal because the user is asking for an
 * autonomous behaviour aimed at themselves.
 */
const SELF_REF_PATTERNS: ReadonlyArray<RegExp> = Object.freeze([
  /\b(send|alert|remind|notify|email|message|sms|ping|brief)\s+me\b/,
  /\bme\s+(a|an|the)\s+(brief|report|summary|alert|reminder|notification|update)\b/,
  /\bnitumie\b/,
  /\bnikumbushe\b/,
]);

const PATTERN_GROUPS: ReadonlyArray<PatternGroup> = Object.freeze([
  { kind: 'recurring-cadence', patterns: RECURRING_PATTERNS },
  { kind: 'conditional-trigger', patterns: CONDITIONAL_PATTERNS },
  { kind: 'imperative-now', patterns: IMPERATIVE_NOW_PATTERNS },
  { kind: 'question-marker', patterns: QUESTION_PATTERNS },
  { kind: 'destructive-verb', patterns: DESTRUCTIVE_PATTERNS },
  { kind: 'recipient-self-reference', patterns: SELF_REF_PATTERNS },
]);

/**
 * Run all pattern groups against the lowercased input. Pure: same input
 * → same Signal[].
 */
export function extractSignals(nl: string): ReadonlyArray<Signal> {
  const input = nl.toLowerCase().trim();
  if (!input) return [];

  const matches: Signal[] = [];
  for (const group of PATTERN_GROUPS) {
    for (const pattern of group.patterns) {
      const m = input.match(pattern);
      if (m) {
        matches.push({ kind: group.kind, matched: m[0] });
      }
    }
  }
  // Freeze for immutability — callers must not mutate.
  return Object.freeze(matches);
}
