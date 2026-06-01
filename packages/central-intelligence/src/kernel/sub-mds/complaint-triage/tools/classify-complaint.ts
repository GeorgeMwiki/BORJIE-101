/**
 * `complaint.classify` — read tier.
 *
 * Classifies a free-text site grievance into:
 *   - category   (maintenance | billing | community | contract-question |
 *                 fair-treatment | safety | privacy | other)
 *   - severity   (critical | urgent | standard | chatter)
 *   - sentiment  (angry | frustrated | neutral | appreciative)
 *
 * Bilingual: Swahili and English are first-class. The classifier is
 * a lexical-prior model — the kernel grounds LLM outputs against it.
 */

export type ComplaintCategory =
  | 'maintenance'
  | 'billing'
  | 'community'
  | 'contract-question'
  | 'fair-treatment'
  | 'safety'
  | 'privacy'
  | 'other';

export type ComplaintSeverity = 'critical' | 'urgent' | 'standard' | 'chatter';
export type ComplaintSentiment = 'angry' | 'frustrated' | 'neutral' | 'appreciative';

export interface ClassifiedComplaint {
  readonly category: ComplaintCategory;
  readonly severity: ComplaintSeverity;
  readonly sentiment: ComplaintSentiment;
  readonly detectedLanguage: 'en' | 'sw' | 'mixed';
  readonly confidence: number;
  readonly rationale: string;
}

interface CategoryRule {
  readonly category: ComplaintCategory;
  readonly weight: number;
  readonly tokens: ReadonlyArray<string>;
  readonly severityFloor?: ComplaintSeverity;
}

const CATEGORY_RULES: ReadonlyArray<CategoryRule> = [
  // SAFETY (highest priority — checked first, severity floor critical)
  { category: 'safety', severityFloor: 'critical', weight: 5, tokens: ['unsafe', 'rockfall', 'pit collapse', 'fire', 'moto', 'gas leak', 'gesi inavuja', 'electric shock', 'mshtuko wa umeme', 'pit flooding', 'shimo limejaa maji', 'tunnel collapse', 'shimo limeanguka', 'mercury exposure', 'cyanide', 'blast accident', 'ajali ya mlipuko'] },
  { category: 'safety', severityFloor: 'critical', weight: 5, tokens: ['being threatened', 'tishio', 'attacked', 'nilishambuliwa', 'violence', 'vurugu', 'i feel unsafe', 'sijihisi salama'] },
  // FAIR-TREATMENT (legal escalation — high severity)
  { category: 'fair-treatment', severityFloor: 'urgent', weight: 4, tokens: ['discrimination', 'ubaguzi', 'harassment', 'unyanyasaji', 'treated unfairly', 'sina haki', 'unfair', 'retaliation', 'kisasi', 'licence suspension threat', 'tishio la kusimamisha leseni'] },
  // PRIVACY
  { category: 'privacy', severityFloor: 'urgent', weight: 4, tokens: ['entered without notice', 'aliingia bila taarifa', 'cctv', 'recorded me', 'aliningia', 'data leak', 'privacy', 'faragha', 'personal data'] },
  // BILLING (settlement / royalty / payment)
  { category: 'billing', weight: 4, tokens: ['underpaid', 'wrong settlement', 'malipo batili', 'wrong amount', 'kiasi sio sahihi', 'royalty deduction', 'makato ya mrabaha', 'advance', 'malipo ya awali', 'refund', 'rejesha pesa', 'short payment', 'malipo pungufu', 'payment', 'settlement', 'malipo'] },
  // COMMUNITY (neighbouring-village grievances — dust, blasting, water)
  { category: 'community', weight: 3, tokens: ['dust from the site', 'vumbi', 'blasting noise', 'kelele za mlipuko', 'noise', 'kelele', 'water contamination', 'maji yamechafuliwa', 'vibration', 'mtetemo', 'land encroachment', 'wanavamia ardhi'] },
  // CONTRACT-QUESTION
  { category: 'contract-question', weight: 3, tokens: ['contract clause', 'kifungu cha mkataba', 'contract says', 'mkataba unasema', 'renew', 'kuongeza muda', 'termination', 'kuvunja mkataba', 'notice period', 'muda wa taarifa', 'offtake agreement', 'mkataba'] },
  // MAINTENANCE (equipment)
  { category: 'maintenance', weight: 3, tokens: ['leak', 'inavuja', 'broken', 'imevunjika', 'not working', 'haifanyi kazi', 'pump', 'pampu', 'generator', 'jenereta', 'excavator', 'crusher', 'conveyor', 'drill', 'mtambo', 'machine', 'mashine'] },
];

const CRITICAL_TOKENS = ['emergency', 'urgent', 'dharura', 'haraka', 'sasa hivi', 'critical', 'life threatening', 'hatari ya maisha', 'trapped', 'amenaswa', 'injured', 'amejeruhiwa'];
const URGENT_TOKENS = ['asap', 'leo', 'today', 'this week', 'wiki hii', 'soon'];
const CHATTER_TOKENS = ['fyi', 'just letting you know', 'nataka kujua tu', 'minor', 'no big deal', 'haina shida sana'];

const ANGRY_TOKENS = ['furious', 'angry', 'nimekasirika', 'hasira', 'fed up', 'nimechoka', 'ridiculous', 'unacceptable', 'disgraceful', 'aibu', 'sue', 'kushtaki', 'lawyer', 'wakili'];
const FRUSTRATED_TOKENS = ['frustrated', 'nimechoka', 'again', 'tena', 'how many times', 'mara ngapi', 'still not fixed', 'bado haijatengenezwa', 'please help', 'tafadhali nisaidie'];
const APPRECIATIVE_TOKENS = ['thank you', 'asante', 'appreciate', 'nashukuru', 'grateful', 'good service'];

const SWAHILI_HEAVY = ['ya', 'na', 'kwa', 'sio', 'hii', 'tafadhali', 'maji', 'madini', 'malipo', 'jirani', 'mkataba', 'siku', 'haifanyi', 'vumbi', 'hatari', 'mwenye', 'kelele', 'haijatengenezwa', 'mlipuko', 'shimo', 'inavuja', 'imevunjika', 'wamenibagua', 'aliingia', 'bila', 'taarifa', 'sijihisi', 'salama', 'sina', 'haki', 'unyanyasaji', 'nimekasirika', 'mtambo'];

export function classifyComplaint(text: string): ClassifiedComplaint {
  const lower = text.toLowerCase();
  const categoryScores = new Map<ComplaintCategory, number>();
  let severityFloor: ComplaintSeverity | undefined;
  const matched: string[] = [];

  for (const rule of CATEGORY_RULES) {
    for (const token of rule.tokens) {
      if (lower.includes(token)) {
        categoryScores.set(rule.category, (categoryScores.get(rule.category) ?? 0) + rule.weight);
        matched.push(token);
        if (rule.severityFloor && severityRank(rule.severityFloor) > severityRank(severityFloor ?? 'chatter')) {
          severityFloor = rule.severityFloor;
        }
      }
    }
  }

  let category: ComplaintCategory = 'other';
  let topScore = 0;
  for (const [cat, score] of categoryScores) {
    if (score > topScore) {
      topScore = score;
      category = cat;
    }
  }

  // Severity — explicit signals can ONLY raise an existing real
  // categorisation. Generic "urgent" without category stays 'chatter'.
  let severity: ComplaintSeverity = severityFloor ?? 'standard';
  if (topScore === 0) {
    severity = 'chatter';
  } else {
    if (CRITICAL_TOKENS.some(t => lower.includes(t)) && severityRank('critical') > severityRank(severity)) {
      severity = 'critical';
    } else if (URGENT_TOKENS.some(t => lower.includes(t)) && severityRank('urgent') > severityRank(severity)) {
      severity = 'urgent';
    } else if (CHATTER_TOKENS.some(t => lower.includes(t)) && !severityFloor) {
      severity = 'chatter';
    }
  }

  // Sentiment
  let sentiment: ComplaintSentiment = 'neutral';
  if (ANGRY_TOKENS.some(t => lower.includes(t))) sentiment = 'angry';
  else if (FRUSTRATED_TOKENS.some(t => lower.includes(t))) sentiment = 'frustrated';
  else if (APPRECIATIVE_TOKENS.some(t => lower.includes(t))) sentiment = 'appreciative';

  // Language detection
  const detectedLanguage = detectLanguage(lower);

  const confidence = Math.min(0.95, 0.4 + topScore * 0.1);

  return Object.freeze({
    category,
    severity,
    sentiment,
    detectedLanguage,
    confidence,
    rationale:
      matched.length > 0
        ? `Matched: ${matched.slice(0, 6).join(', ')}`
        : 'No category tokens matched; defaulted to other/chatter',
  });
}

function severityRank(s: ComplaintSeverity): number {
  return { chatter: 0, standard: 1, urgent: 2, critical: 3 }[s];
}

function detectLanguage(lower: string): 'en' | 'sw' | 'mixed' {
  let swHits = 0;
  for (const w of SWAHILI_HEAVY) {
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
