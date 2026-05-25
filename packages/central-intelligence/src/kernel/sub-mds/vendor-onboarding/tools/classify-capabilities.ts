/**
 * `vendor.classify_capabilities` — read tier.
 *
 * Categorizes the vendor's claimed skills against the canonical
 * capability tags maintained alongside the maintenance-dispatch
 * vendor record. Bilingual.
 */

export type CapabilityTag =
  | 'plumber'
  | 'electrician'
  | 'hvac-tech'
  | 'gas-fitter'
  | 'mason'
  | 'handyman'
  | 'painter'
  | 'cleaner'
  | 'pest-control'
  | 'locksmith'
  | 'security'
  | 'appliance-tech'
  | 'roofer'
  | 'landscaper'
  | 'carpenter';

export interface ClassifiedCapabilities {
  readonly capabilityTags: ReadonlyArray<CapabilityTag>;
  readonly emergencyAvailable: boolean;
  readonly serviceAreas: ReadonlyArray<string>;
  readonly detectedLanguage: 'en' | 'sw' | 'mixed';
  readonly confidence: number;
  readonly rationale: string;
}

interface CapabilityRule {
  readonly tag: CapabilityTag;
  readonly weight: number;
  readonly tokens: ReadonlyArray<string>;
}

const RULES: ReadonlyArray<CapabilityRule> = [
  { tag: 'plumber', weight: 4, tokens: ['plumber', 'plumbing', 'mfereji', 'bomba', 'maji', 'tap', 'sink', 'toilet', 'choo'] },
  { tag: 'electrician', weight: 4, tokens: ['electrician', 'electrical', 'umeme', 'wiring', 'breaker', 'socket', 'taa'] },
  { tag: 'hvac-tech', weight: 4, tokens: ['hvac', 'aircon', 'ac', 'kiyoyozi', 'cooling', 'heating', 'ventilation', 'fan', 'feni'] },
  { tag: 'gas-fitter', weight: 4, tokens: ['gas fitting', 'gas fitter', 'gesi', 'lpg', 'cylinder'] },
  { tag: 'mason', weight: 4, tokens: ['mason', 'masonry', 'concrete', 'plastering', 'sement', 'walling', 'ujenzi'] },
  { tag: 'handyman', weight: 3, tokens: ['handyman', 'general repairs', 'fundi', 'fixing things'] },
  { tag: 'painter', weight: 4, tokens: ['painter', 'painting', 'rangi', 'wall painting', 'kupaka rangi'] },
  { tag: 'cleaner', weight: 3, tokens: ['cleaner', 'cleaning', 'kufanya usafi', 'usafi'] },
  { tag: 'pest-control', weight: 4, tokens: ['pest control', 'pest', 'fumigation', 'wadudu', 'wadudu wa nyumbani', 'mende', 'panya', 'mchwa'] },
  { tag: 'locksmith', weight: 4, tokens: ['locksmith', 'kufuli', 'lock and key', 'rekebisha kufuli'] },
  { tag: 'security', weight: 4, tokens: ['security', 'cctv', 'alarm', 'access control', 'usalama', 'mlinzi'] },
  { tag: 'appliance-tech', weight: 4, tokens: ['appliance', 'fridge repair', 'oven', 'washing machine', 'jiko', 'friji'] },
  { tag: 'roofer', weight: 4, tokens: ['roof', 'roofing', 'paa', 'ukarabati wa paa'] },
  { tag: 'landscaper', weight: 4, tokens: ['landscaper', 'gardening', 'bustani', 'kupanda miti', 'lawn'] },
  { tag: 'carpenter', weight: 4, tokens: ['carpenter', 'carpentry', 'seremala', 'furniture', 'samani'] },
];

const EMERGENCY_TOKENS = ['24/7', 'around the clock', 'emergency', 'dharura', 'on-call', 'on call'];
const SERVICE_AREA_RX = /(?:areas?|maeneo|wilaya|near)\s*[:|-]?\s*([A-Z][\w-]+(?:\s*,\s*[A-Z][\w-]+)*)/gi;
const SWAHILI_INDICATORS = ['na', 'ya', 'kwa', 'mfereji', 'umeme', 'fundi', 'rangi', 'usafi', 'wadudu', 'mlinzi', 'paa', 'bustani', 'samani', 'seremala'];

export function classifyCapabilities(profileText: string): ClassifiedCapabilities {
  const lower = profileText.toLowerCase();
  const tagScores = new Map<CapabilityTag, number>();
  const matched: string[] = [];

  for (const rule of RULES) {
    for (const token of rule.tokens) {
      if (lower.includes(token)) {
        tagScores.set(rule.tag, (tagScores.get(rule.tag) ?? 0) + rule.weight);
        matched.push(token);
      }
    }
  }

  const tags = Array.from(tagScores.entries())
    .filter(([, score]) => score >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  const emergencyAvailable = EMERGENCY_TOKENS.some(t => lower.includes(t));

  // service areas
  const areas: string[] = [];
  let m: RegExpExecArray | null;
  const rx = new RegExp(SERVICE_AREA_RX.source, 'gi');
  while ((m = rx.exec(profileText)) !== null) {
    const raw = m[1];
    if (raw) {
      for (const piece of raw.split(',').map(s => s.trim())) {
        if (piece) areas.push(piece);
      }
    }
  }

  const detectedLanguage = detectLanguage(lower);
  const confidence = Math.min(0.95, 0.3 + tags.length * 0.15);

  return Object.freeze({
    capabilityTags: Object.freeze(tags),
    emergencyAvailable,
    serviceAreas: Object.freeze(areas),
    detectedLanguage,
    confidence,
    rationale:
      matched.length > 0
        ? `Matched tokens: ${matched.slice(0, 6).join(', ')}`
        : 'No capability tokens matched',
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
