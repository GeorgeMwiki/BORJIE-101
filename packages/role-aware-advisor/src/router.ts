/**
 * Question router.
 *
 * Classifies a free-text user question into one of:
 *
 *   - An EXISTING sub-advisor package the orchestrator can hand off
 *     to (sustainability / expansion / acquisition / lifecycle /
 *     green-angle / estate-department / estate-auto-management).
 *
 *   - One of FOUR new brain-direct intents that don't have a backing
 *     package yet (lease, maintenance, market, neighborhood). For
 *     these the orchestrator calls the BrainPort directly with the
 *     role's persona + scoped data snippets.
 *
 *   - `general` — catch-all when nothing matches; the brain handles
 *     it without any sub-advisor routing.
 *
 * The classifier is intentionally a small keyword-weight scorer, not
 * an LLM call. We need this to be deterministic in tests and to run
 * < 1 ms inside the request hot path. The brain can re-route inside
 * its own logic if it disagrees.
 *
 * Each intent carries a `dataNeeds` hint — the resource-kind list the
 * orchestrator should ask the DataPort for. The guard then runs over
 * those before the brain sees them.
 */

import type { ResourceKind } from './roles.js';

export type SubAdvisorIntent =
  | 'sustainability'
  | 'expansion'
  | 'acquisition'
  | 'lifecycle'
  | 'green-angle'
  | 'estate-department'
  | 'estate-auto-management';

export type BrainDirectIntent =
  | 'lease-question'
  | 'maintenance-question'
  | 'market-question'
  | 'neighborhood-question';

export type Intent = SubAdvisorIntent | BrainDirectIntent | 'general';

export interface SubAdvisorRoute {
  readonly intent: Intent;
  readonly score: number;
  /** Resource kinds the orchestrator should fetch to answer well. */
  readonly dataNeeds: ReadonlyArray<ResourceKind>;
  /** True when this intent corresponds to an existing sub-advisor package. */
  readonly isSubAdvisor: boolean;
}

/**
 * Keyword weights — coarse but explainable. The numbers are tuned so
 * that strongly-signalling keywords beat shared ones (e.g. "rent"
 * appears in both lease and market questions — we down-weight it).
 *
 * Tuning notes (re-run `pnpm -F @borjie/role-aware-advisor test`
 * after editing — the 20-sample classifier test pins behaviour):
 *   - keep keywords lowercase, the matcher lowercases input first
 *   - prefer multi-word phrases ('rent renewal') over single tokens
 *     when ambiguity is high
 */
interface KeywordRule {
  readonly intent: Intent;
  readonly keywords: ReadonlyArray<string>;
  readonly weight: number;
}

const RULES: ReadonlyArray<KeywordRule> = [
  // Sustainability / ESG
  {
    intent: 'sustainability',
    keywords: [
      'sustainability',
      'esg',
      'carbon',
      'emissions',
      'breeam',
      'leed',
      'green building',
      'green star',
      'gresb',
      'tcfd',
      'ifrs s2',
      'biodiversity',
      'bng',
      'net zero',
      'embodied carbon',
      'scope 1',
      'scope 2',
      'scope 3',
    ],
    weight: 3,
  },
  {
    intent: 'sustainability',
    keywords: ['energy bill', 'solar', 'insulation', 'heat pump', 'efficiency'],
    weight: 2,
  },

  // Expansion
  {
    intent: 'expansion',
    keywords: [
      'expansion',
      'expand portfolio',
      'expand to',
      'expand into',
      'new market',
      'enter market',
      'enter the',
      'open in',
      'geographic growth',
      'new region',
      'new city',
      'rollout',
      'should we enter',
    ],
    weight: 3,
  },

  // Acquisition
  {
    intent: 'acquisition',
    keywords: [
      'acquire',
      'acquisition',
      'buy property',
      'purchase property',
      'deal underwriting',
      'cap rate',
      'noi',
      'pre-purchase',
      'should i buy',
    ],
    weight: 3,
  },

  // Lifecycle
  {
    intent: 'lifecycle',
    keywords: [
      'lifecycle',
      'asset lifecycle',
      'capex plan',
      'replacement schedule',
      'depreciation',
      'reposition asset',
      'dispose',
      'hold sell',
    ],
    weight: 3,
  },

  // Green-angle (commercial green positioning, distinct from ESG calc)
  {
    intent: 'green-angle',
    keywords: [
      'green premium',
      'green angle',
      'green marketing',
      'esg story',
      'green narrative',
      'sustainability brand',
      'eco branding',
    ],
    weight: 3,
  },

  // Estate department (HR / staffing of the estate org)
  {
    intent: 'estate-department',
    keywords: [
      'estate department',
      'hire estate manager',
      'staff structure',
      'org chart',
      'estate org',
      'team structure',
      'department setup',
    ],
    weight: 3,
  },

  // Estate auto-management (the autonomous-management features)
  {
    intent: 'estate-auto-management',
    keywords: [
      'auto management',
      'auto-management',
      'autonomous',
      'auto rent collection',
      'auto pilot',
      'set and forget',
      'automate management',
      'agent take over',
    ],
    weight: 3,
  },

  // Brain-direct: lease
  {
    intent: 'lease-question',
    keywords: [
      'lease',
      'tenancy',
      'rental agreement',
      'renew lease',
      'renewal',
      'break clause',
      'notice period',
      'deposit',
      'security deposit',
      'is my rent fair',
      'rent fair',
      'renegotiate',
    ],
    weight: 3,
  },
  {
    intent: 'lease-question',
    keywords: ['rent', 'rental', 'landlord'],
    weight: 1,
  },

  // Brain-direct: maintenance
  {
    intent: 'maintenance-question',
    keywords: [
      'maintenance',
      'repair',
      'fix',
      'broken',
      'leak',
      'water leak',
      'plumbing',
      'electric',
      'electrical',
      'pest',
      'mould',
      'mold',
      'hvac',
      'air conditioning',
      'a/c',
      'work order',
    ],
    weight: 3,
  },

  // Brain-direct: market
  {
    intent: 'market-question',
    keywords: [
      'market rate',
      'market value',
      'market comparison',
      'comparable',
      'comp set',
      'comps',
      'yield',
      'rental yield',
      'price trend',
      'market trend',
      'absorption',
    ],
    weight: 3,
  },

  // Brain-direct: neighborhood
  {
    intent: 'neighborhood-question',
    keywords: [
      'neighborhood',
      'neighbourhood',
      'area',
      'school',
      'commute',
      'safety',
      'crime',
      'amenities',
      'transit',
      'public transport',
      'walkability',
    ],
    weight: 3,
  },
];

/** Resource needs per intent. Used by the orchestrator to fan-out fetches. */
const DATA_NEEDS: Record<Intent, ReadonlyArray<ResourceKind>> = {
  sustainability: [
    'owned-properties',
    'managed-portfolio',
    'public-market-data',
    'lesson-store',
  ],
  expansion: ['public-market-data', 'owned-properties', 'lesson-store'],
  acquisition: ['public-market-data', 'public-listing', 'lesson-store'],
  lifecycle: ['owned-properties', 'managed-portfolio', 'lesson-store'],
  'green-angle': ['owned-properties', 'public-market-data'],
  'estate-department': ['managed-portfolio', 'staff-notes'],
  'estate-auto-management': [
    'managed-portfolio',
    'tenant-aggregate-no-pii',
    'lesson-store',
  ],
  'lease-question': ['own-lease', 'own-unit', 'public-market-data'],
  'maintenance-question': ['own-maintenance', 'own-unit', 'assigned-jobs'],
  'market-question': ['public-market-data', 'public-listing'],
  'neighborhood-question': [
    'public-neighborhood-data',
    'public-market-data',
    'building-public-info',
  ],
  general: ['lesson-store'],
};

const SUB_ADVISOR_INTENTS = new Set<Intent>([
  'sustainability',
  'expansion',
  'acquisition',
  'lifecycle',
  'green-angle',
  'estate-department',
  'estate-auto-management',
]);

/**
 * Classify `question` (the user's free-text) into the highest-scoring
 * intent. Score 0 means no rule matched — falls back to `general`.
 */
export function routeQuestion(question: string): SubAdvisorRoute {
  const q = ` ${question.toLowerCase()} `;
  const scores = new Map<Intent, number>();

  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (q.includes(` ${kw} `) || q.includes(`${kw} `) || q.includes(` ${kw}`)) {
        scores.set(rule.intent, (scores.get(rule.intent) ?? 0) + rule.weight);
      }
    }
  }

  let bestIntent: Intent = 'general';
  let bestScore = 0;
  for (const [intent, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  return {
    intent: bestIntent,
    score: bestScore,
    dataNeeds: DATA_NEEDS[bestIntent],
    isSubAdvisor: SUB_ADVISOR_INTENTS.has(bestIntent),
  };
}
