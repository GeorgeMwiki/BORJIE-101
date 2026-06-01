/**
 * `after_hours.classify_inquiry` — read tier.
 *
 * Classifies an inbound prospective-buyer message into one of five
 * intents. Bilingual (Swahili + English). Lexical-prior model — the
 * kernel grounds LLM classifier outputs to this deterministic baseline.
 * Holdout: 50+ cases, ≥85% accuracy target.
 */

export type InquiryIntent =
  | 'lot-search'
  | 'inspection-request'
  | 'pricing'
  | 'availability'
  | 'general';

export interface InquiryFeatures {
  readonly quantityKg?: number;
  readonly budgetMinor?: number;
  readonly collectWithinDays?: number;
  readonly region?: string;
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
    intent: 'inspection-request',
    weight: 5,
    tokens: [
      'inspect the lot',
      'inspect the parcel',
      'assay the',
      'come see',
      'come to see',
      'arrange an inspection',
      'schedule an inspection',
      'book an inspection',
      'site visit',
      'naomba kuja kukagua',
      'ninaomba kukagua',
      'kuja kukagua madini',
      'naomba kuja kuangalia',
      'when can i see',
      'available to inspect',
      'come over to see',
    ],
  },
  {
    intent: 'pricing',
    weight: 4,
    tokens: [
      'how much',
      'price is',
      'price per',
      'cost',
      'rate per gram',
      'rate per kg',
      'bei ni',
      'gharama',
      'pesa ngapi',
      'utozaji',
      'price per kg',
    ],
  },
  {
    intent: 'availability',
    weight: 4,
    tokens: [
      'is it still available',
      'still in stock',
      'available now',
      'when will it be ready',
      'iko bado',
      'ipo bado',
      'inapatikana lini',
      'when can i collect',
      'collection date',
    ],
  },
  {
    intent: 'lot-search',
    weight: 4,
    tokens: [
      'looking for',
      'searching for',
      'i need',
      'do you have',
      'available lots',
      'nahitaji madini',
      'natafuta madini',
      'unayo dhahabu',
      'mna madini',
      'is there a',
      'any lots',
      'need a parcel',
      'i want to buy',
    ],
  },
];

const QUANTITY_RX = /(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos|kilogram|gram|grams|g|tonne|tonnes|ton)\b/i;
const BUDGET_RX = /(?:budget|bei|gharama|spend|tsh|kes|usd|\$)\D{0,10}(\d{2,10})(?:\s*(?:k|000|m|million))?/i;
const COLLECT_RX = /(?:collect|deliver|kuchukua|nataka kuchukua)[^\d]{0,20}(\d+)\s*(?:day|days|siku|wiki|weeks?)/i;
const REGION_RX = /(?:in|from|kwenye|maeneo ya|around|near)\s+([A-Z][a-zA-Z-]{2,30})/;

const SWAHILI_INDICATORS = [
  'naomba', 'nahitaji', 'natafuta', 'ninaomba', 'tafadhali', 'mna', 'unayo',
  'madini', 'dhahabu', 'mawe', 'kilo', 'bei', 'kukagua', 'kuangalia', 'kuja',
  'inapatikana', 'lini', 'wapi', 'ngapi', 'gharama', 'kuchukua',
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
  const qtyMatch = text.match(QUANTITY_RX);
  if (qtyMatch && qtyMatch[1]) {
    const raw = parseFloat(qtyMatch[1]);
    const unit = (qtyMatch[2] ?? '').toLowerCase();
    if (!Number.isNaN(raw) && raw >= 0) {
      // normalise to kilograms
      let kg = raw;
      if (/^(g|gram|grams)$/.test(unit)) kg = raw / 1000;
      else if (/^(tonne|tonnes|ton)$/.test(unit)) kg = raw * 1000;
      features.quantityKg = Number(kg.toFixed(3));
    }
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
  const collectMatch = text.match(COLLECT_RX);
  if (collectMatch && collectMatch[1]) {
    const n = parseInt(collectMatch[1], 10);
    if (!Number.isNaN(n)) features.collectWithinDays = n;
  }
  const regionMatch = text.match(REGION_RX);
  if (regionMatch && regionMatch[1]) {
    features.region = regionMatch[1];
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
