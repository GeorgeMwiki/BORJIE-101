/**
 * `leasing.classify_inquiry` — read tier.
 *
 * Classifies an inbound prospect message into one of five intents.
 * Bilingual (Swahili + English). Lexical-prior model — the kernel
 * grounds LLM classifier outputs to this deterministic baseline.
 * Holdout: 50+ cases, ≥85% accuracy target.
 */

export type InquiryIntent =
  | 'vacancy-check'
  | 'viewing-request'
  | 'pricing'
  | 'availability'
  | 'general';

export interface InquiryFeatures {
  readonly bedrooms?: number;
  readonly budgetMinor?: number;
  readonly moveInWithinDays?: number;
  readonly neighborhood?: string;
}

export interface ClassifiedInquiry {
  readonly intent: InquiryIntent;
  readonly features: InquiryFeatures;
  readonly detectedLanguage: 'en' | 'sw' | 'mixed';
  readonly confidence: number;
  readonly rationale: string;
}

interface IntentRule {
  readonly intent: InquiryIntent;
  readonly weight: number;
  readonly tokens: ReadonlyArray<string>;
}

const RULES: ReadonlyArray<IntentRule> = [
  {
    intent: 'viewing-request',
    weight: 5,
    tokens: [
      'view the unit',
      'view the apartment',
      'come see',
      'come to see',
      'arrange a viewing',
      'schedule a viewing',
      'book a viewing',
      'naomba kuja kuona',
      'ninaomba kuangalia',
      'kuja kuangalia nyumba',
      'naomba kuja kuangalia',
      'when can i see',
      'available to view',
      'site visit',
      'come over to see',
    ],
  },
  {
    intent: 'pricing',
    weight: 4,
    tokens: [
      'how much',
      'price is',
      'rent is',
      'cost',
      'monthly rent',
      'kodi ni',
      'bei ni',
      'gharama',
      'pesa ngapi',
      'utozaji',
      'rate per month',
    ],
  },
  {
    intent: 'availability',
    weight: 4,
    tokens: [
      'is it still available',
      'still vacant',
      'available now',
      'when will it be ready',
      'iko bado',
      'iko vacant',
      'inapatikana lini',
      'when can i move in',
      'move-in date',
    ],
  },
  {
    intent: 'vacancy-check',
    weight: 4,
    tokens: [
      'looking for',
      'searching for',
      'i need a',
      'do you have',
      'available units',
      'nahitaji nyumba',
      'natafuta nyumba',
      'unayo nyumba',
      'mna nyumba',
      'is there a',
      'any vacancies',
      'need an apartment',
      'i want to rent',
    ],
  },
];

const BEDROOM_RX = /(\d+)\s*[-]?\s*(br|bedroom|chumba|vyumba|bed)/i;
const BUDGET_RX = /(?:budget|kodi|bei|gharama|spend|tsh|kes|usd|\$)\D{0,10}(\d{2,8})(?:\s*(?:k|000))?/i;
const MOVE_IN_RX = /(?:move\s*in|kuingia|nataka kuingia)[^\d]{0,20}(\d+)\s*(?:day|days|siku|wiki|weeks?)/i;
const NEIGHBORHOOD_RX = /(?:in|kwenye|maeneo ya|around|near)\s+([A-Z][a-zA-Z-]{2,30})/;

const SWAHILI_INDICATORS = [
  'naomba', 'nahitaji', 'natafuta', 'ninaomba', 'tafadhali', 'mna', 'unayo',
  'nyumba', 'chumba', 'vyumba', 'kodi', 'kuangalia', 'kuja', 'inapatikana',
  'lini', 'wapi', 'ngapi', 'gharama', 'bei',
];

export function classifyInquiry(text: string): ClassifiedInquiry {
  const lower = text.toLowerCase();
  const scores = new Map<InquiryIntent, number>();
  const matched: string[] = [];

  for (const rule of RULES) {
    for (const token of rule.tokens) {
      if (lower.includes(token)) {
        scores.set(rule.intent, (scores.get(rule.intent) ?? 0) + rule.weight);
        matched.push(token);
      }
    }
  }

  let intent: InquiryIntent = 'general';
  let topScore = 0;
  for (const [k, v] of scores) {
    if (v > topScore) {
      topScore = v;
      intent = k;
    }
  }

  const features: { -readonly [K in keyof InquiryFeatures]: InquiryFeatures[K] } = {};
  const brMatch = text.match(BEDROOM_RX);
  if (brMatch && brMatch[1]) {
    const n = parseInt(brMatch[1], 10);
    if (!Number.isNaN(n) && n >= 0 && n <= 9) features.bedrooms = n;
  }
  const budgetMatch = text.match(BUDGET_RX);
  if (budgetMatch && budgetMatch[1]) {
    const raw = parseInt(budgetMatch[1], 10);
    if (!Number.isNaN(raw)) {
      // crude budget normalisation: if input mentioned k/thousands, scale
      const scaled = /k|000/.test(budgetMatch[0]) ? raw * 1000 : raw;
      features.budgetMinor = scaled * 100;
    }
  }
  const moveMatch = text.match(MOVE_IN_RX);
  if (moveMatch && moveMatch[1]) {
    const n = parseInt(moveMatch[1], 10);
    if (!Number.isNaN(n)) features.moveInWithinDays = n;
  }
  const neighborMatch = text.match(NEIGHBORHOOD_RX);
  if (neighborMatch && neighborMatch[1]) {
    features.neighborhood = neighborMatch[1];
  }

  const detectedLanguage = detectLanguage(lower);
  const confidence = topScore === 0 ? 0.3 : Math.min(0.95, 0.4 + topScore * 0.1);

  return Object.freeze({
    intent,
    features: Object.freeze(features),
    detectedLanguage,
    confidence,
    rationale:
      matched.length > 0
        ? `Matched tokens: ${matched.slice(0, 5).join(', ')}`
        : 'No intent tokens matched; defaulted to general',
  });
}

function detectLanguage(lower: string): 'en' | 'sw' | 'mixed' {
  let swHits = 0;
  for (const w of SWAHILI_INDICATORS) {
    if (lower.includes(` ${w} `) || lower.startsWith(`${w} `) || lower.endsWith(` ${w}`) || lower === w) {
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
