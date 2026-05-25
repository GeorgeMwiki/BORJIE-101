/**
 * `lease.classify_termination_request` — read tier.
 *
 * Classifies tenant-initiated termination intent into:
 *   - notice-of-intent (formal, with date)
 *   - exploratory (asking about the process)
 *   - urgent-emergency (job-loss, illness)
 *   - dispute-driven (citing a problem)
 *   - silent (auto-detect via prolonged non-engagement signals)
 *
 * Bilingual lexical classifier.
 */

export type TerminationKind =
  | 'notice-of-intent'
  | 'exploratory'
  | 'urgent-emergency'
  | 'dispute-driven'
  | 'silent';

export interface ClassifiedTermination {
  readonly kind: TerminationKind;
  readonly noticeRequestedDate?: string;
  readonly detectedLanguage: 'en' | 'sw' | 'mixed';
  readonly confidence: number;
  readonly rationale: string;
}

interface KindRule {
  readonly kind: TerminationKind;
  readonly weight: number;
  readonly tokens: ReadonlyArray<string>;
}

const RULES: ReadonlyArray<KindRule> = [
  {
    kind: 'notice-of-intent',
    weight: 5,
    tokens: [
      'giving notice',
      'i am giving notice',
      'formal notice',
      'notice of intent',
      'one month notice',
      'two months notice',
      '30 day notice',
      '30-day notice',
      'will be moving out',
      'i will vacate',
      'natoa taarifa',
      'nataka kuondoka mwezi',
      'taarifa rasmi ya kuondoka',
    ],
  },
  {
    kind: 'urgent-emergency',
    weight: 5,
    tokens: [
      'lost my job',
      'nimepoteza kazi',
      'medical emergency',
      'dharura ya matibabu',
      'family emergency',
      'cannot stay',
      'siwezi kukaa',
      'need to leave immediately',
      'lazima niondoke haraka',
    ],
  },
  {
    kind: 'dispute-driven',
    weight: 4,
    tokens: [
      'breach of contract',
      'kuvunja mkataba',
      'landlord did not',
      'mmiliki hakufanya',
      'because of the maintenance',
      'kwa sababu ya matengenezo',
      'unfair treatment',
      'unaharassed',
      'cannot live here anymore',
    ],
  },
  {
    kind: 'exploratory',
    weight: 3,
    tokens: [
      'what is the process',
      'how do i terminate',
      'process for ending lease',
      'utaratibu wa kumaliza',
      'naomba kujua utaratibu',
      'thinking about moving',
      'considering moving out',
      'i am considering',
    ],
  },
];

const DATE_RX = /(\d{1,2})[ -/](?:[a-zA-Z]{3,9}|\d{1,2})[ -/](\d{2,4})|(\d{4}-\d{2}-\d{2})/;
const SWAHILI_INDICATORS = ['kuondoka', 'taarifa', 'mkataba', 'mmiliki', 'siwezi', 'kumaliza', 'naomba', 'wapi', 'lini'];

export function classifyTerminationRequest(text: string): ClassifiedTermination {
  const lower = text.toLowerCase();
  const scores = new Map<TerminationKind, number>();
  const matched: string[] = [];

  for (const rule of RULES) {
    for (const token of rule.tokens) {
      if (lower.includes(token)) {
        scores.set(rule.kind, (scores.get(rule.kind) ?? 0) + rule.weight);
        matched.push(token);
      }
    }
  }

  let kind: TerminationKind = 'silent';
  let topScore = 0;
  for (const [k, v] of scores) {
    if (v > topScore) {
      topScore = v;
      kind = k;
    }
  }
  if (topScore === 0) kind = 'silent';

  // Date extraction
  const dateMatch = text.match(DATE_RX);
  const noticeDate = dateMatch ? dateMatch[0] : undefined;

  const detectedLanguage = detectLanguage(lower);
  const confidence = topScore === 0 ? 0.3 : Math.min(0.95, 0.4 + topScore * 0.1);

  return Object.freeze({
    kind,
    ...(noticeDate ? { noticeRequestedDate: noticeDate } : {}),
    detectedLanguage,
    confidence,
    rationale:
      matched.length > 0
        ? `Matched tokens: ${matched.slice(0, 5).join(', ')}`
        : 'No termination tokens matched',
  });
}

function detectLanguage(lower: string): 'en' | 'sw' | 'mixed' {
  let swHits = 0;
  for (const w of SWAHILI_INDICATORS) {
    if (lower.includes(` ${w} `) || lower.startsWith(`${w} `) || lower.endsWith(` ${w}`)) {
      swHits += 1;
    }
  }
  const tokens = lower.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'en';
  const ratio = swHits / Math.max(tokens.length, 1);
  if (ratio > 0.18) return 'sw';
  if (ratio > 0.05) return 'mixed';
  return 'en';
}
