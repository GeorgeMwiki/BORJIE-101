/**
 * `vendor.classify_capabilities` — read tier.
 *
 * Categorizes the contractor's claimed skills against the canonical
 * capability tags maintained alongside the maintenance-dispatch
 * contractor record. Bilingual.
 */

export type CapabilityTag =
  | 'pump-tech'
  | 'electrician'
  | 'hydraulics-tech'
  | 'process-fitter'
  | 'diesel-mechanic'
  | 'boilermaker'
  | 'rigger'
  | 'civil'
  | 'surveyor'
  | 'blasting'
  | 'assayer'
  | 'safety-tech'
  | 'haulage'
  | 'fabrication'
  | 'general-hand';

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
  { tag: 'pump-tech', weight: 4, tokens: ['pump tech', 'pump technician', 'dewatering', 'pampu', 'slurry pump', 'borehole pump'] },
  { tag: 'electrician', weight: 4, tokens: ['electrician', 'electrical', 'umeme', 'wiring', 'switchgear', 'transformer', 'motor rewind'] },
  { tag: 'hydraulics-tech', weight: 4, tokens: ['hydraulics', 'hydraulic', 'haidroliki', 'hose', 'cylinder', 'ram'] },
  { tag: 'process-fitter', weight: 4, tokens: ['process fitter', 'crusher', 'ball mill', 'kinu', 'wash plant', 'screen', 'cyclone'] },
  { tag: 'diesel-mechanic', weight: 4, tokens: ['diesel mechanic', 'mechanic', 'engine', 'haul truck', 'excavator', 'loader', 'fleet', 'gari'] },
  { tag: 'boilermaker', weight: 4, tokens: ['boilermaker', 'welding', 'kulehemu', 'plate work', 'wear plate'] },
  { tag: 'rigger', weight: 4, tokens: ['rigger', 'rigging', 'crane', 'lifting', 'winch'] },
  { tag: 'civil', weight: 4, tokens: ['civil', 'concrete', 'sement', 'retaining wall', 'road works', 'ujenzi', 'culvert'] },
  { tag: 'surveyor', weight: 4, tokens: ['surveyor', 'survey', 'pegging', 'upimaji', 'gps survey', 'mine survey'] },
  { tag: 'blasting', weight: 4, tokens: ['blasting', 'blast', 'shotfirer', 'milipuko', 'explosives', 'baruti'] },
  { tag: 'assayer', weight: 4, tokens: ['assayer', 'assay', 'lab', 'fire assay', 'sampling', 'maabara'] },
  { tag: 'safety-tech', weight: 4, tokens: ['safety', 'ventilation', 'gas detection', 'usalama', 'fire suppression', 'mine rescue'] },
  { tag: 'haulage', weight: 4, tokens: ['haulage', 'transport', 'usafirishaji', 'tipper', 'cartage', 'logistics'] },
  { tag: 'fabrication', weight: 4, tokens: ['fabrication', 'fabricator', 'sheet metal', 'machining', 'workshop'] },
  { tag: 'general-hand', weight: 3, tokens: ['general hand', 'general labour', 'fundi wa kawaida', 'cleaning', 'housekeeping', 'usafi'] },
];

const EMERGENCY_TOKENS = ['24/7', 'around the clock', 'emergency', 'dharura', 'on-call', 'on call'];
const SERVICE_AREA_RX = /(?:areas?|maeneo|wilaya|near)\s*[:|-]?\s*([A-Z][\w-]+(?:\s*,\s*[A-Z][\w-]+)*)/gi;
const SWAHILI_INDICATORS = ['na', 'ya', 'kwa', 'pampu', 'umeme', 'fundi', 'kinu', 'usafi', 'milipuko', 'upimaji', 'maabara', 'usalama', 'usafirishaji', 'haidroliki'];

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
