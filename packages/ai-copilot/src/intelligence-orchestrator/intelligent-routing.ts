/**
 * Intelligent Routing — LLM-free routing of admin queries to the right
 * sub-persona + module fetcher.
 *
 * Maps user text to one of BORJIE's operational sub-personas via
 * keyword+heuristics. No LLM involved — pure deterministic routing so the
 * system behaves the same every run.
 *
 * Used by the Brain to decide (before invoking an LLM) which fetchers
 * to prime and which persona to bind.
 *
 * @module intelligence-orchestrator/intelligent-routing
 */

export type RoutingDestination =
  | 'manager'
  | 'owner_advisor'
  | 'tenant_ops'
  | 'collector'
  | 'maintenance_coordinator'
  | 'compliance_officer'
  | 'marketplace_agent'
  | 'professor';

export interface RoutingDecision {
  readonly destination: RoutingDestination;
  readonly confidence: number;
  readonly rationale: string;
  readonly fetchersToPrime: readonly string[];
}

export interface RoutingConfig {
  readonly defaultDestination: RoutingDestination;
  readonly minConfidence: number;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = Object.freeze({
  defaultDestination: 'manager',
  minConfidence: 0.5,
});

interface RouteRule {
  readonly destination: RoutingDestination;
  readonly keywords: readonly RegExp[];
  readonly fetchersToPrime: readonly string[];
  readonly rationale: string;
}

const RULES: readonly RouteRule[] = [
  {
    destination: 'collector',
    keywords: [
      /\barrear/i,
      /\b(late|overdue)\s*(rent|payment)/i,
      /\bcollect/i,
      /\bdemand\s+letter/i,
    ],
    fetchersToPrime: ['payments', 'tenantRisk', 'compliance'],
    rationale: 'mentions arrears / collection / demand',
  },
  {
    destination: 'maintenance_coordinator',
    keywords: [
      /\b(leak|leaking|broken|repair|plumbing|electrical|hvac)\b/i,
      /\bmaintenance/i,
      /\bfix\s+/i,
      /\bcase/i,
    ],
    fetchersToPrime: ['maintenance', 'far', 'inspection'],
    rationale: 'mentions maintenance / repair',
  },
  {
    destination: 'compliance_officer',
    keywords: [
      /\bcompliance/i,
      /\b(notice|regulator|KRA|TRA|GePG)\b/i,
      /\bbreach/i,
      /\binspection/i,
    ],
    fetchersToPrime: ['compliance', 'inspection'],
    rationale: 'mentions compliance / regulator / notice',
  },
  {
    destination: 'marketplace_agent',
    keywords: [
      /\bvacan/i,
      /\bmarketplace/i,
      /\blisting/i,
      /\bshow(ing|er)\b/i,
      /\b(advertise|campaign)/i,
    ],
    fetchersToPrime: ['occupancy', 'leasing'],
    rationale: 'mentions vacancy / marketplace / listing',
  },
  {
    destination: 'tenant_ops',
    keywords: [
      /\btenant\b/i,
      /\blease/i,
      /\brenewal/i,
      /\bcomplain/i,
      /\bdispute/i,
    ],
    fetchersToPrime: ['leasing', 'tenantRisk', 'payments'],
    rationale: 'mentions tenant / lease / renewal / complaint',
  },
  {
    destination: 'owner_advisor',
    keywords: [
      /\bowner\b/i,
      /\breport\b/i,
      /\bportfolio\b/i,
      /\byield\b/i,
      /\broi\b/i,
    ],
    fetchersToPrime: ['payments', 'maintenance', 'occupancy'],
    rationale: 'mentions owner / portfolio / yield',
  },
  {
    destination: 'professor',
    keywords: [
      /\bwhy\b/i,
      /\bexplain\b/i,
      /\bteach\s+me/i,
      /\bhow\s+does/i,
    ],
    fetchersToPrime: [],
    rationale: 'explanation / teaching intent',
  },
];

export function routeAdminQuery(
  text: string,
  config: RoutingConfig = DEFAULT_ROUTING_CONFIG,
): RoutingDecision {
  if (!text || text.trim().length === 0) {
    return {
      destination: config.defaultDestination,
      confidence: 0.2,
      rationale: 'empty input',
      fetchersToPrime: [],
    };
  }

  const scored: Array<{ rule: RouteRule; score: number }> = [];
  for (const rule of RULES) {
    let score = 0;
    for (const pattern of rule.keywords) {
      if (pattern.test(text)) score += 1;
    }
    if (score > 0) scored.push({ rule, score });
  }
  if (scored.length === 0) {
    return {
      destination: config.defaultDestination,
      confidence: 0.3,
      rationale: 'no keyword match — default route',
      fetchersToPrime: ['payments', 'maintenance', 'compliance'],
    };
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  // total possible score = top rule's keyword count; cap confidence at 0.95
  const maxScore = top.rule.keywords.length;
  const confidence = Math.min(0.95, 0.5 + (top.score / maxScore) * 0.45);

  return {
    destination:
      confidence >= config.minConfidence
        ? top.rule.destination
        : config.defaultDestination,
    confidence,
    rationale: top.rule.rationale,
    fetchersToPrime: top.rule.fetchersToPrime,
  };
}
