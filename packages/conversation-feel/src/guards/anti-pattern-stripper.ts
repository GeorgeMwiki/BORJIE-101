/**
 * Anti-pattern detector + stripper.
 *
 * Detects and strips the canonical chatbot-feel openers, closers, and
 * apologies before a reply leaves the system. Substance is preserved; only
 * filler is removed.
 *
 * Locale discipline: each rule set is anchored to ONE language. When the
 * active locale is `en`, only English rules run; when `sw`, only Swahili
 * rules run. The stripper never injects words in either language — it only
 * deletes filler and restores leading capitalization (Latin script, locale-
 * agnostic). An `en` reply therefore stays `en` and an `sw` reply stays `sw`.
 *
 * References:
 *  - Anthropic, "Sycophancy in Language Models" (2024) — filler agreement.
 *  - OpenAI, "Conversational Design Guidelines" (2024).
 */

import type {
  ChatbotFeelPattern,
  Locale,
  RemovedPhrase,
  StrippedResponse,
} from '../types.js';

interface PatternRule {
  readonly pattern: ChatbotFeelPattern;
  readonly regex: RegExp;
  readonly reason: string;
  readonly score_weight: number;
}

// ---------------------------------------------------------------------------
// English rule set
// ---------------------------------------------------------------------------

const EN_FILLER_OPENERS: ReadonlyArray<PatternRule> = [
  {
    pattern: 'filler_opener',
    regex:
      /^\s*(sure|of course|absolutely|certainly|definitely|gladly)[!,.\s]+/i,
    reason: 'filler_opener: enthusiastic acknowledgment without substance',
    score_weight: 8,
  },
  {
    pattern: 'filler_opener',
    regex:
      /^\s*(great|excellent|wonderful|fantastic|awesome) (question|point|idea)[!,.\s]+/i,
    reason: "filler_opener: praising the user's question",
    score_weight: 10,
  },
  {
    pattern: 'filler_opener',
    regex:
      /^\s*i('?d| would) be (happy|glad|delighted|more than happy) to[^.]*[.!]\s*/i,
    reason: 'filler_opener: theatrical eagerness',
    score_weight: 9,
  },
  {
    pattern: 'filler_opener',
    regex: /^\s*(got it|i understand|understood|noted)[!,.\s]+/i,
    reason: 'filler_opener: empty acknowledgment',
    score_weight: 7,
  },
  {
    pattern: 'filler_opener',
    regex:
      /^\s*(thanks|thank you) for (your |the |that )?(question|message|input)[!,.\s]+/i,
    reason: 'filler_opener: thanking for asking',
    score_weight: 8,
  },
];

const EN_VERBOSE_PREAMBLES: ReadonlyArray<PatternRule> = [
  {
    pattern: 'verbose_preamble',
    regex: /^\s*let me (think about|consider|reflect on) (this|that)[^.]*[.!]\s*/i,
    reason: 'verbose_preamble: announcing thought process',
    score_weight: 6,
  },
  {
    pattern: 'verbose_preamble',
    regex:
      /^\s*that('?s| is) (a|an) (interesting|good|tough|tricky|complex) (situation|question|problem|case)[^.]*[.!]\s*/i,
    reason: 'verbose_preamble: characterizing the question',
    score_weight: 7,
  },
  {
    pattern: 'verbose_preamble',
    regex: /^\s*before (i|we) (answer|continue|proceed|begin)[^.]*[,.]\s*/i,
    reason: 'verbose_preamble: throat-clearing',
    score_weight: 6,
  },
  {
    pattern: 'verbose_preamble',
    regex:
      /^\s*(based on|given|considering) (what you('?ve| have) (said|asked|mentioned|shared))[^.]*[,.]\s*/i,
    reason: 'verbose_preamble: paraphrased setup',
    score_weight: 5,
  },
];

const EN_SYCOPHANTIC_AGREEMENT: ReadonlyArray<PatternRule> = [
  {
    pattern: 'sycophantic_agreement',
    regex:
      /\bthat('?s| is) (a |an )?(great|excellent|wonderful|fantastic|brilliant|amazing) (point|idea|observation|question|insight)[!.]/gi,
    reason: 'sycophantic_agreement: empty praise of user input',
    score_weight: 10,
  },
  {
    pattern: 'sycophantic_agreement',
    regex:
      /\byou('?re| are) (absolutely |completely |totally |entirely )?(right|correct|spot on)[!.]/gi,
    reason: 'sycophantic_agreement: blanket affirmation',
    score_weight: 9,
  },
  {
    pattern: 'sycophantic_agreement',
    regex: /\b(great|excellent|wonderful) (thinking|reasoning|analysis)[!.]/gi,
    reason: "sycophantic_agreement: praising the user's reasoning",
    score_weight: 8,
  },
];

const EN_THEATRICAL_APOLOGIES: ReadonlyArray<PatternRule> = [
  {
    pattern: 'theatrical_apology',
    regex:
      /\bi (apologi[sz]e|am sorry|'m sorry) for (any |the )?(confusion|inconvenience|misunderstanding)[^.]*[.!]/gi,
    reason: 'theatrical_apology: performative regret',
    score_weight: 8,
  },
  {
    pattern: 'theatrical_apology',
    regex:
      /\bi('?m| am) (so |very |truly |really )?sorry (i |that i )?(can'?t|cannot|don'?t have|am unable)[^.]*[.!]/gi,
    reason: 'theatrical_apology: dramatic limitation apology',
    score_weight: 9,
  },
  {
    pattern: 'theatrical_apology',
    regex:
      /\bunfortunately[,]?\s+i (don'?t|cannot|can'?t|am unable to)[^.]*[.!]/gi,
    reason: 'theatrical_apology: unfortunately-prefixed limitation',
    score_weight: 7,
  },
];

const EN_FILLER_CLOSERS: ReadonlyArray<PatternRule> = [
  {
    pattern: 'anything_else_closer',
    regex:
      /\s*is there (anything|something) (else )?(i can )?help (you )?with[?!.]*\s*$/i,
    reason: 'anything_else_closer: generic offer to keep helping',
    score_weight: 10,
  },
  {
    pattern: 'filler_closer',
    regex:
      /\s*(i )?hope (this|that) (helps|answers your question|clarifies)[!.]*\s*$/i,
    reason: 'filler_closer: hopeful sign-off',
    score_weight: 8,
  },
  {
    pattern: 'filler_closer',
    regex:
      /\s*let me know if (you (have )?any|there are any|there's anything)[^.]*[.!]\s*$/i,
    reason: 'filler_closer: open-ended availability',
    score_weight: 7,
  },
  {
    pattern: 'filler_closer',
    regex:
      /\s*(feel free to|don'?t hesitate to) (ask|reach out|let me know)[^.]*[.!]\s*$/i,
    reason: 'filler_closer: invitation to ask more',
    score_weight: 7,
  },
  {
    pattern: 'filler_closer',
    regex: /\s*happy to help[!.]*\s*$/i,
    reason: 'filler_closer: parting enthusiasm',
    score_weight: 6,
  },
];

const EN_GENERIC_TRANSITIONS: ReadonlyArray<PatternRule> = [
  {
    pattern: 'generic_transition',
    regex: /\bnow,? let'?s (discuss|talk about|move on to|turn to)\b/gi,
    reason: 'generic_transition: announcing topic shift',
    score_weight: 5,
  },
  {
    pattern: 'generic_transition',
    regex: /\bmoving on to\b/gi,
    reason: 'generic_transition: explicit transition phrase',
    score_weight: 4,
  },
];

const EN_RULES: ReadonlyArray<PatternRule> = [
  ...EN_FILLER_OPENERS,
  ...EN_VERBOSE_PREAMBLES,
  ...EN_SYCOPHANTIC_AGREEMENT,
  ...EN_THEATRICAL_APOLOGIES,
  ...EN_FILLER_CLOSERS,
  ...EN_GENERIC_TRANSITIONS,
];

// ---------------------------------------------------------------------------
// Swahili rule set — same anti-pattern families, Swahili-only phrasing.
// These mirror the English openers/closers/apologies so an sw reply gets
// equivalent treatment without ever importing an English word.
// ---------------------------------------------------------------------------

const SW_FILLER_OPENERS: ReadonlyArray<PatternRule> = [
  {
    pattern: 'filler_opener',
    regex: /^\s*(bila shaka|hakika|ndiyo kabisa|kwa furaha)[!,.\s]+/i,
    reason: 'filler_opener: enthusiastic acknowledgment without substance (sw)',
    score_weight: 8,
  },
  {
    pattern: 'filler_opener',
    regex: /^\s*(swali|wazo|hoja) (zuri|nzuri|bora)[!,.\s]+/i,
    reason: "filler_opener: praising the user's question (sw)",
    score_weight: 10,
  },
  {
    pattern: 'filler_opener',
    regex: /^\s*nita(furahi|penda) (sana )?ku[^.]*[.!]\s*/i,
    reason: 'filler_opener: theatrical eagerness (sw)',
    score_weight: 9,
  },
  {
    pattern: 'filler_opener',
    regex: /^\s*(nimeelewa|nimepata|sawa kabisa)[!,.\s]+/i,
    reason: 'filler_opener: empty acknowledgment (sw)',
    score_weight: 7,
  },
  {
    pattern: 'filler_opener',
    regex: /^\s*asante kwa (swali|ujumbe|maoni)[^.]*[!,.\s]+/i,
    reason: 'filler_opener: thanking for asking (sw)',
    score_weight: 8,
  },
];

const SW_VERBOSE_PREAMBLES: ReadonlyArray<PatternRule> = [
  {
    pattern: 'verbose_preamble',
    regex: /^\s*ngoja ni(fikirie|tafakari) (hili|jambo hili)[^.]*[.!]\s*/i,
    reason: 'verbose_preamble: announcing thought process (sw)',
    score_weight: 6,
  },
  {
    pattern: 'verbose_preamble',
    regex: /^\s*hili ni swali (zuri|gumu|tata)[^.]*[.!]\s*/i,
    reason: 'verbose_preamble: characterizing the question (sw)',
    score_weight: 7,
  },
  {
    pattern: 'verbose_preamble',
    regex: /^\s*kabla ya ku(jibu|endelea|anza)[^.]*[,.]\s*/i,
    reason: 'verbose_preamble: throat-clearing (sw)',
    score_weight: 6,
  },
];

const SW_SYCOPHANTIC_AGREEMENT: ReadonlyArray<PatternRule> = [
  {
    pattern: 'sycophantic_agreement',
    regex: /\bhoja (nzuri|bora) (sana|kabisa)[!.]/gi,
    reason: 'sycophantic_agreement: empty praise of user input (sw)',
    score_weight: 10,
  },
  {
    pattern: 'sycophantic_agreement',
    regex: /\b(uko|upo) sahihi kabisa[!.]/gi,
    reason: 'sycophantic_agreement: blanket affirmation (sw)',
    score_weight: 9,
  },
];

const SW_THEATRICAL_APOLOGIES: ReadonlyArray<PatternRule> = [
  {
    pattern: 'theatrical_apology',
    regex: /\bna(omba radhi|samehe) kwa (mkanganyiko|usumbufu)[^.]*[.!]/gi,
    reason: 'theatrical_apology: performative regret (sw)',
    score_weight: 8,
  },
  {
    pattern: 'theatrical_apology',
    regex: /\bsamahani (sana )?(kwa kuwa )?si(wezi|na)[^.]*[.!]/gi,
    reason: 'theatrical_apology: dramatic limitation apology (sw)',
    score_weight: 9,
  },
];

const SW_FILLER_CLOSERS: ReadonlyArray<PatternRule> = [
  {
    pattern: 'anything_else_closer',
    regex:
      /\s*kuna (jambo|kitu|swali)?\s*(lingine|kingine)?\s*(ninaweza|naweza) kukusaidia(\s*nao)?[?!.]*\s*$/i,
    reason: 'anything_else_closer: generic offer to keep helping (sw)',
    score_weight: 10,
  },
  {
    pattern: 'filler_closer',
    regex: /\s*natumaini (hili |hii )?(imekusaidia|imesaidia)[!.]*\s*$/i,
    reason: 'filler_closer: hopeful sign-off (sw)',
    score_weight: 8,
  },
  {
    pattern: 'filler_closer',
    regex: /\s*nijulishe kama (una|kuna)[^.]*[.!]\s*$/i,
    reason: 'filler_closer: open-ended availability (sw)',
    score_weight: 7,
  },
  {
    pattern: 'filler_closer',
    regex: /\s*nipo (hapa )?kukusaidia[!.]*\s*$/i,
    reason: 'filler_closer: parting enthusiasm (sw)',
    score_weight: 6,
  },
];

const SW_RULES: ReadonlyArray<PatternRule> = [
  ...SW_FILLER_OPENERS,
  ...SW_VERBOSE_PREAMBLES,
  ...SW_SYCOPHANTIC_AGREEMENT,
  ...SW_THEATRICAL_APOLOGIES,
  ...SW_FILLER_CLOSERS,
];

function rulesFor(locale: Locale): ReadonlyArray<PatternRule> {
  return locale === 'sw' ? SW_RULES : EN_RULES;
}

/**
 * Pure: strip chatbot-feel patterns from a reply while preserving substance.
 * Operates strictly within the active locale — never injects the other
 * language. Returns a new immutable record.
 */
export function stripChatbotFeel(
  input: string,
  locale: Locale = 'en',
): StrippedResponse {
  if (!input || typeof input !== 'string') {
    return {
      stripped: input ?? '',
      original: input ?? '',
      removed_phrases: [],
      residual_chatbot_score: 0,
    };
  }

  const rules = rulesFor(locale);
  let working = input;
  const removed: RemovedPhrase[] = [];

  // Iterate up to 3 passes so chained openers ("Sure! Of course! ...") get
  // peeled in sequence even though each opener regex anchors to ^.
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const rule of rules) {
      const flags = rule.regex.flags.includes('g')
        ? rule.regex.flags
        : rule.regex.flags + 'g';
      const re = new RegExp(rule.regex.source, flags);
      const matches = Array.from(working.matchAll(re));
      if (matches.length === 0) continue;
      for (const match of matches) {
        removed.push({
          pattern: rule.pattern,
          phrase: match[0].trim(),
          position: match.index ?? 0,
          reason: rule.reason,
        });
      }
      const next = working.replace(re, '');
      if (next !== working) {
        working = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Restore leading capitalization if a stripped opener left a lowercase
  // start. Pure Latin-script transform; safe for both locales.
  const trimmed = working.trim();
  const first = trimmed.charAt(0);
  const stripped =
    trimmed.length > 0 ? first.toUpperCase() + trimmed.slice(1) : trimmed;

  const residual = computeResidualScore(stripped, locale);

  return {
    stripped,
    original: input,
    removed_phrases: removed,
    residual_chatbot_score: residual,
  };
}

function computeResidualScore(text: string, locale: Locale): number {
  let score = 0;
  // Excessive exclamation points (locale-agnostic punctuation).
  const exclaims = (text.match(/!/g) ?? []).length;
  if (exclaims > 2) score += Math.min(20, (exclaims - 2) * 4);
  // Hedge phrases beyond one — locale-specific vocabulary.
  const hedgeRx =
    locale === 'sw'
      ? /\b(labda|huenda|inawezekana|inategemea|pengine)\b/gi
      : /\b(perhaps|maybe|might|could be|possibly|it depends|sort of|kind of)\b/gi;
  const hedges = (text.match(hedgeRx) ?? []).length;
  if (hedges > 1) score += Math.min(20, (hedges - 1) * 5);
  // Mechanical bullet markers in short prose (locale-agnostic).
  const bullets = (text.match(/^\s*[-*•]\s+/gm) ?? []).length;
  if (bullets > 0 && text.length < 250 && bullets >= 3) score += 15;
  return Math.min(100, score);
}

/**
 * Pure: tells the caller whether stripping should escalate to a regen
 * request (when too much was removed and the reply is now substance-light).
 */
export function shouldRequestRegen(result: StrippedResponse): boolean {
  if (result.removed_phrases.length === 0) return false;
  const removedChars = result.removed_phrases.reduce(
    (n, r) => n + r.phrase.length,
    0,
  );
  const totalChars = result.original.length || 1;
  const removalRatio = removedChars / totalChars;
  // If more than 60% of the reply was filler, ask the model to regenerate.
  return removalRatio > 0.6 || result.stripped.trim().length < 12;
}
