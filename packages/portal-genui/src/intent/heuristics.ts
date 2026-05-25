/**
 * Heuristic intent classifier.
 *
 * First pass — cheap, deterministic, no network. Catches the most
 * common phrasings users use when they're casually asking for a
 * new tab ("I need to track our staff payroll", "set up our supplier
 * onboarding", "let's add a compliance dashboard"). When this layer
 * either fires with high confidence (≥ 0.75) or rejects with high
 * confidence (≤ 0.05), the caller can skip the LLM round-trip.
 *
 * Design notes:
 *   - Pure / synchronous / no allocations beyond a few small arrays.
 *   - Case-insensitive matching; punctuation-tolerant.
 *   - Returns a confidence in [0, 1] derived from match strength.
 *   - Domain bucketing uses the FIRST domain that matches; ties
 *     broken by the order declared in DOMAIN_KEYWORDS (most-common
 *     first), so "tracking our employee leave" classifies as `hr`
 *     before `compliance`.
 *   - Intent verbs are required — a message that names a domain but
 *     lacks an intent verb ("our HR is broken") returns null. This
 *     keeps the false-positive rate low on chit-chat.
 */

import type { PortalTab, TabGenerationIntent } from '../types.js';

// ────────────────────────────────────────────────────────────────────
// Vocabulary
// ────────────────────────────────────────────────────────────────────

/**
 * Verbs / phrases that flag a user is asking for NEW UI scaffolding,
 * not just talking about an existing feature. Ordered roughly by
 * specificity — more specific phrases boost confidence more.
 */
const INTENT_PHRASES: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly weight: number;
}> = [
  { pattern: /\bcreate (?:a |an |the )?(?:new )?tab\b/i, weight: 0.55 },
  { pattern: /\bset up (?:a |an |the )?(?:new )?(?:section|tab|module|area)\b/i, weight: 0.45 },
  { pattern: /\b(?:add|build|spin up|stand up) (?:a |an |the )?(?:new )?(?:tab|section|module|dashboard|tracker)\b/i, weight: 0.45 },
  { pattern: /\b(?:i|we) (?:need|want|would like) (?:a |an |the )?(?:way |place |area )?(?:to )?(?:track|manage|monitor|record|handle|store|keep|maintain)\b/i, weight: 0.45 },
  { pattern: /\b(?:i|we)(?:'d| would) like (?:a |an |the )?(?:way |place |area )?(?:to )?(?:track|manage|monitor|record|handle|store)\b/i, weight: 0.4 },
  { pattern: /\b(?:i|we) (?:need|want|would like) (?:a |an |the )?(?:place|area|space|spot)\b/i, weight: 0.4 },
  { pattern: /\b(?:let'?s|let us|lets) (?:add|create|build|set up|track|manage|spin up|stand up)\b/i, weight: 0.4 },
  { pattern: /\b(?:could|can) (?:we|you) (?:add|build|create|set up|track|manage)\b/i, weight: 0.3 },
  { pattern: /\b(?:i|we) don'?t have (?:a |an |the )?(?:way )?(?:to )?(?:track|manage|monitor|record)\b/i, weight: 0.4 },
  { pattern: /\b(?:i|we) need to (?:track|manage|monitor|record|handle|store|keep|maintain)\b/i, weight: 0.55 },
  { pattern: /\bplease (?:add|create|set up|build|spin up|stand up)\b/i, weight: 0.45 },
];

/**
 * Domain → keyword bucket. The first bucket whose keyword count tops
 * the threshold wins. Buckets are ordered from most-common-first so
 * "leave tracking" routes to `hr` not `compliance`.
 */
const DOMAIN_KEYWORDS: ReadonlyArray<{
  readonly domain: PortalTab['domain'];
  readonly keywords: ReadonlyArray<string>;
  readonly defaultTitle: string;
}> = [
  {
    domain: 'hr',
    keywords: [
      'payroll',
      'salary',
      'salaries',
      'wage',
      'wages',
      'staff',
      'employee',
      'employees',
      'leave',
      'pto',
      'holiday',
      'holidays',
      'sick day',
      'sick days',
      'hr',
      'recruitment',
      'recruiting',
      'hiring',
      'onboarding',
      'offboarding',
      'time off',
      'attendance',
      'time sheet',
      'timesheet',
      'performance review',
      'one on one',
      'one-on-one',
    ],
    defaultTitle: 'HR',
  },
  {
    domain: 'finance',
    keywords: [
      'finance',
      'financial',
      'budget',
      'budgets',
      'expense',
      'expenses',
      'invoice',
      'invoices',
      'revenue',
      'p&l',
      'pnl',
      'profit',
      'loss',
      'cash flow',
      'cashflow',
      'forecast',
      'forecasting',
      'accounts payable',
      'accounts receivable',
      'ap',
      'ar',
      'tax',
      'taxes',
      'tax audit',
      'general ledger',
      'gl',
      'reconciliation',
    ],
    defaultTitle: 'Finance',
  },
  {
    domain: 'compliance',
    keywords: [
      'compliance',
      'audit',
      'audit log',
      'audit logs',
      'auditor',
      'auditors',
      'gdpr',
      'soc 2',
      'soc2',
      'iso',
      'kyc',
      'aml',
      'sanctions',
      'policy',
      'policies',
      'regulation',
      'regulations',
      'risk register',
      'incident',
      'incidents',
      'breach',
      'data protection',
    ],
    defaultTitle: 'Compliance',
  },
  {
    domain: 'procurement',
    keywords: [
      'procurement',
      'supplier',
      'suppliers',
      'vendor management',
      'purchase order',
      'purchase orders',
      'po',
      'rfp',
      'rfq',
      'sourcing',
      'contract management',
      'supplier onboarding',
      'tender',
      'tenders',
    ],
    defaultTitle: 'Procurement',
  },
  {
    domain: 'operations',
    keywords: [
      'maintenance schedule',
      'inspection',
      'inspections',
      'work order',
      'work orders',
      'asset register',
      'fleet',
      'inventory',
      'stock',
      'warehouse',
      'logistics',
      'dispatch',
      'shift',
      'shifts',
      'roster',
    ],
    defaultTitle: 'Operations',
  },
  {
    domain: 'sales',
    keywords: [
      'sales',
      'pipeline',
      'lead',
      'leads',
      'deal',
      'deals',
      'crm',
      'opportunity',
      'opportunities',
      'quote',
      'quotes',
      'commission',
      'commissions',
      'sales rep',
    ],
    defaultTitle: 'Sales',
  },
  {
    domain: 'marketing',
    keywords: [
      'marketing',
      'campaign',
      'campaigns',
      'newsletter',
      'newsletters',
      'social media',
      'utm',
      'attribution',
      'brand',
      'creative',
      'content calendar',
      'editorial',
    ],
    defaultTitle: 'Marketing',
  },
  {
    domain: 'engineering',
    keywords: [
      'engineering',
      'sprint',
      'sprints',
      'backlog',
      'incident',
      'on call',
      'on-call',
      'oncall',
      'deployment',
      'deployments',
      'release',
      'releases',
      'sla',
      'slo',
      'runbook',
      'postmortem',
    ],
    defaultTitle: 'Engineering',
  },
  {
    domain: 'legal',
    keywords: [
      'legal',
      'contract',
      'contracts',
      'nda',
      'ndas',
      'litigation',
      'court',
      'matter',
      'matters',
      'counsel',
      'in house counsel',
      'legal hold',
    ],
    defaultTitle: 'Legal',
  },
  {
    domain: 'sustainability',
    keywords: [
      'sustainability',
      'esg',
      'carbon',
      'emissions',
      'scope 1',
      'scope 2',
      'scope 3',
      'net zero',
      'biodiversity',
      'green building',
      'breeam',
      'leed',
      'energy use',
    ],
    defaultTitle: 'Sustainability',
  },
];

/**
 * Word-boundary-aware substring check. We don't pre-compile regexes
 * for every keyword (would be hundreds) — instead we escape + test
 * inline. Multi-word keywords need spaces preserved; single-word
 * keywords need a leading + trailing `\W` (or string boundary).
 */
function wordContains(haystack: string, needle: string): boolean {
  if (!needle) return false;
  // Escape RegExp metacharacters in the needle.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
  return re.test(haystack);
}

// ────────────────────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────────────────────

export interface HeuristicVerdict {
  readonly classified: TabGenerationIntent | null;
  /**
   * Confidence the heuristic layer has in its decision (irrespective
   * of whether it classified). High values let the caller skip the
   * LLM round-trip; mid values (`0.2 < c < 0.75`) escalate.
   */
  readonly heuristicConfidence: number;
}

/** Sanitize a domain bucket into a stable tab-key (alphanumeric + dot). */
function toTabKey(domain: PortalTab['domain'], hint: string): string {
  const slug = hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length > 0 ? `${domain}.${slug}` : domain;
}

/**
 * Pull a short noun phrase out of the message to use as the tab
 * title — falls back to the domain's default. Pure regex; no LLM.
 */
function extractNounPhrase(message: string): string | null {
  const lowered = message.toLowerCase();
  const trackMatch = lowered.match(
    /(?:track|manage|monitor|handle|record)\s+(?:our|my|the)?\s*([a-z][a-z\s'-]{2,40})/i,
  );
  if (trackMatch?.[1]) {
    return trackMatch[1].trim().replace(/\s+/g, ' ');
  }
  const sectionMatch = lowered.match(
    /(?:tab|section|module|dashboard|tracker)\s+(?:for|about)\s+([a-z][a-z\s'-]{2,40})/i,
  );
  if (sectionMatch?.[1]) {
    return sectionMatch[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

/** Run the heuristic. Pure / deterministic. */
export function classifyHeuristic(message: string): HeuristicVerdict {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { classified: null, heuristicConfidence: 1 };
  }
  const trimmed = message.trim().slice(0, 2048);

  // 1) Intent verbs
  const evidence: string[] = [];
  let intentScore = 0;
  for (const { pattern, weight } of INTENT_PHRASES) {
    const match = trimmed.match(pattern);
    if (match) {
      intentScore += weight;
      evidence.push(match[0]);
    }
  }
  if (intentScore === 0) {
    // No verb → return rejection with HIGH confidence so caller skips LLM.
    return { classified: null, heuristicConfidence: 0.92 };
  }

  // 2) Domain bucket — keyword match requires word-boundary alignment.
  //    Pure `includes()` would let "research" match the "ar" keyword
  //    from accounts-receivable, leaking generic prose into Finance.
  const lowered = trimmed.toLowerCase();
  let chosenDomain: PortalTab['domain'] | null = null;
  let chosenDefaultTitle = '';
  let domainMatchCount = 0;
  for (const bucket of DOMAIN_KEYWORDS) {
    let count = 0;
    for (const kw of bucket.keywords) {
      if (wordContains(lowered, kw)) {
        count += 1;
        evidence.push(kw);
      }
    }
    if (count > domainMatchCount) {
      chosenDomain = bucket.domain;
      chosenDefaultTitle = bucket.defaultTitle;
      domainMatchCount = count;
    }
  }

  if (!chosenDomain) {
    // Intent verb present but no domain → escalate to LLM (medium conf).
    return { classified: null, heuristicConfidence: 0.45 };
  }

  // 3) Build the intent.
  const noun = extractNounPhrase(trimmed);
  const tabTitle = noun
    ? titleCase(noun).slice(0, 60)
    : chosenDefaultTitle;
  const tabKey = toTabKey(chosenDomain, noun ?? chosenDefaultTitle);

  // Confidence = intent score (cap at 0.7) + domain bonus (cap at 0.3).
  const intentComponent = Math.min(intentScore, 0.7);
  const domainBonus = Math.min(0.15 * domainMatchCount, 0.3);
  const confidence = Math.min(intentComponent + domainBonus, 1);

  return {
    classified: {
      proposedTabKey: tabKey,
      proposedTabTitle: tabTitle,
      domain: chosenDomain,
      confidence,
      evidence: evidence.slice(0, 10),
      sourceMessage: trimmed,
      usedLlm: false,
    },
    heuristicConfidence: confidence,
  };
}
