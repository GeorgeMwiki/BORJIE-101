/**
 * `complaint.classify` — read tier.
 *
 * Classifies a free-text complaint into:
 *   - category   (maintenance | billing | neighbor-noise |
 *                 lease-question | fair-treatment | safety |
 *                 privacy | other)
 *   - severity   (critical | urgent | standard | chatter)
 *   - sentiment  (angry | frustrated | neutral | appreciative)
 *
 * Bilingual: Swahili and English are first-class. The classifier is
 * a lexical-prior model — the kernel grounds LLM outputs against it.
 */

export type ComplaintCategory =
  | 'maintenance'
  | 'billing'
  | 'neighbor-noise'
  | 'lease-question'
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
  { category: 'safety', severityFloor: 'critical', weight: 5, tokens: ['unsafe', 'broken stairs', 'fire', 'moto', 'smoke alarm', 'gas leak', 'gesi inavuja', 'electric shock', 'mshtuko wa umeme', 'flood', 'mafuriko', 'structural collapse', 'paa limeanguka', 'wall collapse'] },
  { category: 'safety', severityFloor: 'critical', weight: 5, tokens: ['being threatened', 'tishio', 'attacked', 'nilishambuliwa', 'violence', 'vurugu', 'i feel unsafe', 'sijihisi salama'] },
  // FAIR-TREATMENT (legal escalation — high severity)
  { category: 'fair-treatment', severityFloor: 'urgent', weight: 4, tokens: ['discrimination', 'ubaguzi', 'harassment', 'unyanyasaji', 'treated unfairly', 'sina haki', 'unfair', 'retaliation', 'kisasi', 'eviction threat', 'tishio la kufukuzwa'] },
  // PRIVACY
  { category: 'privacy', severityFloor: 'urgent', weight: 4, tokens: ['entered without notice', 'aliingia bila taarifa', 'cctv', 'recorded me', 'aliningia', 'data leak', 'privacy', 'faragha', 'personal data'] },
  // BILLING
  { category: 'billing', weight: 4, tokens: ['overcharged', 'wrong invoice', 'ankara batili', 'wrong amount', 'kiasi sio sahihi', 'rent calculation', 'hesabu ya kodi', 'deposit', 'amana', 'refund', 'rejesha pesa', 'late fee', 'faini ya kuchelewa', 'billing', 'invoice', 'ankara'] },
  // NEIGHBOR-NOISE
  { category: 'neighbor-noise', weight: 3, tokens: ['noisy neighbour', 'jirani mwenye kelele', 'loud music', 'muziki mkubwa', 'noise', 'kelele', 'party next door', 'late night', 'usiku', 'shouting', 'wanapiga kelele'] },
  // LEASE-QUESTION
  { category: 'lease-question', weight: 3, tokens: ['lease clause', 'kifungu cha mkataba', 'contract says', 'mkataba unasema', 'renew', 'kuongeza muda', 'termination', 'kuvunja mkataba', 'notice period', 'muda wa taarifa', 'lease', 'mkataba'] },
  // MAINTENANCE
  { category: 'maintenance', weight: 3, tokens: ['leak', 'inavuja', 'broken', 'imevunjika', 'not working', 'haifanyi kazi', 'plumbing', 'mfereji', 'electric', 'umeme', 'tap', 'bomba', 'pest', 'wadudu', 'ac', 'kiyoyozi', 'appliance'] },
];

const CRITICAL_TOKENS = ['emergency', 'urgent', 'dharura', 'haraka', 'sasa hivi', 'critical', 'life threatening', 'hatari ya maisha', 'baby', 'mtoto', 'elderly', 'mzee'];
const URGENT_TOKENS = ['asap', 'leo', 'today', 'this week', 'wiki hii', 'soon'];
const CHATTER_TOKENS = ['fyi', 'just letting you know', 'nataka kujua tu', 'minor', 'no big deal', 'haina shida sana'];

const ANGRY_TOKENS = ['furious', 'angry', 'nimekasirika', 'hasira', 'fed up', 'nimechoka', 'ridiculous', 'unacceptable', 'disgraceful', 'aibu', 'sue', 'kushtaki', 'lawyer', 'wakili'];
const FRUSTRATED_TOKENS = ['frustrated', 'nimechoka', 'again', 'tena', 'how many times', 'mara ngapi', 'still not fixed', 'bado haijatengenezwa', 'please help', 'tafadhali nisaidie'];
const APPRECIATIVE_TOKENS = ['thank you', 'asante', 'appreciate', 'nashukuru', 'grateful', 'good service'];

const SWAHILI_HEAVY = ['ya', 'na', 'kwa', 'sio', 'hii', 'tafadhali', 'maji', 'umeme', 'kodi', 'jirani', 'mkataba', 'siku', 'haifanyi', 'ankara', 'hatari', 'mwenye', 'kelele', 'haijatengenezwa', 'mtoto', 'mzee', 'inavuja', 'imevunjika', 'wamenibagua', 'aliingia', 'bila', 'taarifa', 'sijihisi', 'salama', 'sina', 'haki', 'unyanyasaji', 'nimekasirika', 'haba'];

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
